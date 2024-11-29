'use strict';

const bcrypt = require('bcrypt');

// In-memory storage for threads
const threadStorage = {
  threads: [],
  nextThreadId: 1,
  nextReplyId: 1,

  // Method to get recent threads for a specific board
  getRecentThreads(board, limit = 10) {
    // Filter threads by board and sort by most recent
    const boardThreads = this.threads
      .filter(thread => thread.board === board)
      .sort((a, b) => b.bumped_on - a.bumped_on)
      .slice(0, limit);

    // For each thread, get the 3 most recent replies
    return boardThreads.map(thread => {
      const threadCopy = { ...thread };

      // Sort replies by most recent and limit to 3
      threadCopy.replies = thread.replies
        .sort((a, b) => b.created_on - a.created_on)
        .slice(0, 3)
        .map(reply => {
          // Exclude sensitive information from replies
          const { delete_password, reported, ...safeReply } = reply;
          return safeReply;
        });

      // Exclude sensitive information from the thread
      delete threadCopy.delete_password;
      delete threadCopy.reported;

      return threadCopy;
    });
  }
};

module.exports = function (app) {
  // Thread Routes
  app.route('/api/threads/:board')
    // GET route to retrieve recent threads
    .get(function (req, res) {
      try {
        const board = req.params.board;

        // Retrieve recent threads
        const recentThreads = threadStorage.getRecentThreads(board);

        res.status(200).json(recentThreads);
      } catch (error) {
        console.error('Error retrieving threads:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    })
    // POST route to create a new thread
    .post(async function (req, res) {
      try {
        const { board, text, delete_password } = req.body;

        // Validate input
        if (!board || !text || !delete_password) {
          return res.status(400).json({
            error: 'Missing required fields: board, text, or delete_password'
          });
        }

        // Hash the delete password
        const hashedPassword = await bcrypt.hash(delete_password, 10);

        // Create new thread object
        const newThread = {
          _id: threadStorage.nextThreadId++,
          board,
          text,
          delete_password: hashedPassword,
          created_on: new Date(),
          bumped_on: new Date(),
          reported: false,
          replies: []
        };

        // Store the thread
        threadStorage.threads.push(newThread);

        // Respond with the created thread (excluding hashed password)
        const responseThread = { ...newThread };
        delete responseThread.delete_password;
        delete responseThread.reported;

        res.status(201).json(responseThread);
      } catch (error) {
        console.error('Error creating thread:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    })
    // DELETE route to remove a thread
    .delete(async function (req, res) {
      try {
        const { _id, delete_password } = req.body;
        const board = req.params.board;

        // Find the thread
        const thread = threadStorage.threads.find(
          t => t._id === _id && t.board === board
        );

        if (!thread) {
          return res.status(404).json({ error: 'Thread not found' });
        }

        // Verify delete password
        const isPasswordValid = await bcrypt.compare(delete_password, thread.delete_password);

        if (!isPasswordValid) {
          return res.status(403).json({ error: 'Incorrect delete password' });
        }

        // Remove the thread
        threadStorage.threads = threadStorage.threads.filter(
          t => t._id !== _id || t.board !== board
        );

        res.status(200).json({ message: 'Thread deleted successfully' });
      } catch (error) {
        console.error('Error deleting thread:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

  // Reply Routes
  app.route('/api/replies/:board')
    // POST route to add a reply to a thread
    .post(async function (req, res) {
      try {
        const { _id, text, delete_password } = req.body;
        const board = req.params.board;

        // Find the thread
        const thread = threadStorage.threads.find(
          t => t._id === _id && t.board === board
        );

        if (!thread) {
          return res.status(404).json({ error: 'Thread not found' });
        }

        // Hash the delete password
        const hashedPassword = await bcrypt.hash(delete_password, 10);

        // Create reply object
        const newReply = {
          reply_id: threadStorage.nextReplyId++,
          text,
          delete_password: hashedPassword,
          created_on: new Date(),
          reported: false
        };

        // Add reply to thread
        thread.replies.push(newReply);

        // Update thread's bumped_on time
        thread.bumped_on = new Date();

        // Respond with the created reply (excluding sensitive info)
        const responseReply = { ...newReply };
        delete responseReply.delete_password;
        delete responseReply.reported;

        res.status(201).json(responseReply);
      } catch (error) {
        console.error('Error creating reply:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    })
    // DELETE route to remove a reply
    .delete(async function (req, res) {
      try {
        const { _id, reply_id, delete_password } = req.body;
        const board = req.params.board;

        // Find the thread
        const thread = threadStorage.threads.find(
          t => t._id === _id && t.board === board
        );

        if (!thread) {
          return res.status(404).json({ error: 'Thread not found' });
        }

        // Find the reply
        const replyIndex = thread.replies.findIndex(r => r.reply_id === reply_id);

        if (replyIndex === -1) {
          return res.status(404).json({ error: 'Reply not found' });
        }

        const reply = thread.replies[replyIndex];

        // Verify delete password
        const isPasswordValid = await bcrypt.compare(delete_password, reply.delete_password);

        if (!isPasswordValid) {
          return res.status(403).json({ error: 'Incorrect delete password' });
        }

        // Remove the reply
        thread.replies.splice(replyIndex, 1);

        res.status(200).json({ message: 'Reply deleted successfully' });
      } catch (error) {
        console.error('Error deleting reply:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

  // Reporting Routes
  app.route('/api/threads/:board')
    .put(function (req, res) {
      const { _id } = req.body;
      const board = req.params.board;

      // Find the thread
      const thread = threadStorage.threads.find(
        t => t._id === _id && t.board === board
      );

      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      // Mark thread as reported
      thread.reported = true;

      res.status(200).json({ message: 'Thread reported successfully' });
    });

  app.route('/api/replies/:board')
    .put(function (req, res) {
      const { _id, reply_id } = req.body;
      const board = req.params.board;

      // Find the thread
      const thread = threadStorage.threads.find(
        t => t._id === _id && t.board === board
      );

      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      // Find the reply
      const reply = thread.replies.find(r => r.reply_id === reply_id);

      if (!reply) {
        return res.status(404).json({ error: 'Reply not found' });
      }

      // Mark reply as reported
      reply.reported = true;

      res.status(200).json({ message: 'Reply reported successfully' });
    });
};

module.exports.threadStorage = threadStorage;


