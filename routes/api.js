'use strict';

const bcrypt = require('bcrypt');
const bodyParser = require('body-parser');

// In-memory storage for threads
const threadStorage = {
  threads: [],
  nextThreadId: 1,
  nextReplyId: 1,

  // Existing getRecentThreads method remains the same
  getRecentThreads(board, limit = 10) {
    const boardThreads = this.threads
      .filter(thread => thread.board === board)
      .sort((a, b) => b.bumped_on - a.bumped_on)
      .slice(0, limit);

    return boardThreads.map(thread => {
      const threadCopy = { ...thread };

      threadCopy.replies = thread.replies
        .sort((a, b) => b.created_on - a.created_on)
        .slice(0, 3)
        .map(reply => {
          const { delete_password, reported, ...safeReply } = reply;
          return safeReply;
        });

      delete threadCopy.delete_password;
      delete threadCopy.reported;

      return threadCopy;
    });
  }
};

module.exports = function (app) {
  // Add body parsing middleware to support both JSON and form data
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  // Helper function to normalize input
  const normalizeInput = (req) => {
    // Prioritize JSON body, fall back to form data
    return req.body || {};
  };

  // Thread Routes
  app.route('/api/threads/:board')
    // GET route remains the same
    .get(function (req, res) {
      try {
        const board = req.params.board;
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
        // Use normalized input
        const input = normalizeInput(req);
        const { board } = req.params;
        const { text, delete_password } = input;

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
          thread_id: threadStorage.nextThreadId++,
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
        responseThread.id = responseThread.thread_id;
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
        // Use normalized input
        const input = normalizeInput(req);
        const { thread_id, delete_password } = input;
        const board = req.params.board;

        // Find the thread
        const thread = threadStorage.threads.find(
          t => t.thread_id === thread_id && t.board === board
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
          t => t.thread_id !== thread_id || t.board !== board
        );

        res.status(200).json({ message: 'Thread deleted successfully' });
      } catch (error) {
        console.error('Error deleting thread:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    })
    // PUT route for reporting a thread
    .put(function (req, res) {
      // Use normalized input
      const input = normalizeInput(req);
      const { thread_id } = input;
      const board = req.params.board;

      // Find the thread
      const thread = threadStorage.threads.find(
        t => t.thread_id === thread_id && t.board === board
      );

      if (!thread) {
        return res.status(404).json({ error: 'Thread not found' });
      }

      // Mark thread as reported
      thread.reported = true;

      res.status(200).json({ message: 'Thread reported successfully' });
    });

  // Reply Routes
  app.route('/api/replies/:board')
    // POST route to add a reply to a thread
    .post(async function (req, res) {
      try {
        // Use normalized input
        const input = normalizeInput(req);
        const { thread_id, text, delete_password } = input;
        const board = req.params.board;

        // Find the thread
        const thread = threadStorage.threads.find(
          t => t.thread_id === thread_id && t.board === board
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
        // Use normalized input
        const input = normalizeInput(req);
        const { thread_id, reply_id, delete_password } = input;
        const board = req.params.board;

        // Find the thread
        const thread = threadStorage.threads.find(
          t => t.thread_id === thread_id && t.board === board
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
    })
    // PUT route for reporting a reply
    .put(function (req, res) {
      // Use normalized input
      const input = normalizeInput(req);
      const { thread_id, reply_id } = input;
      const board = req.params.board;

      // Find the thread
      const thread = threadStorage.threads.find(
        t => t.thread_id === thread_id && t.board === board
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