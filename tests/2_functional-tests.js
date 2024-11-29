const chaiHttp = require('chai-http');
const chai = require('chai');
const assert = chai.assert;
const server = require('../server');
const { threadStorage } = require('../routes/api');

chai.use(chaiHttp);

suite('Functional Tests', function () {
    // Clear thread storage before each test
    beforeEach(function () {
        threadStorage.threads = [];
        threadStorage.nextThreadId = 1;
        threadStorage.nextReplyId = 1;
    });

    suite('POST /api/threads/{board} Tests', function () {
        test('Create a new thread successfully', function (done) {
            const board = 'testBoard';
            const threadData = {
                board: board,
                text: 'This is a test thread',
                delete_password: 'securePassword123'
            };

            chai.request(server)
                .post(`/api/threads/${board}`)
                .send(threadData)
                .end(function (err, res) {
                    assert.isNull(err, 'No error should be returned');

                    // Check response status
                    assert.equal(res.status, 201, 'Response should be 201 Created');

                    // Check response body
                    assert.isObject(res.body, 'Response should be an object');

                    // Verify specific properties
                    assert.property(res.body, 'thread_id', 'Response should have thread_id');
                    assert.isNumber(res.body.thread_id, 'thread_id should be a number');

                    assert.equal(res.body.board, board, 'Board should match the requested board');
                    assert.equal(res.body.text, threadData.text, 'Text should match the submitted text');

                    // Verify date properties
                    assert.property(res.body, 'created_on', 'Should have created_on timestamp');
                    assert.property(res.body, 'bumped_on', 'Should have bumped_on timestamp');

                    // Ensure sensitive data is not returned
                    assert.notProperty(res.body, 'delete_password', 'Delete password should not be in response');

                    done();
                });
        });
    });

    suite('GET /api/threads/{board} Tests', function () {
        test('Retrieve recent threads with replies', function (done) {
            const board = 'testBoard';

            // Create multiple threads with replies
            const threadData = [
                { board: 'testBoard', text: 'First thread', delete_password: 'pass1' },
                { board: 'testBoard', text: 'Second thread', delete_password: 'pass2' },
                { board: 'testBoard', text: 'Third thread', delete_password: 'pass3' }
            ];

            // Helper function to create threads and replies
            function createThreadsWithReplies(callback) {
                chai.request(server)
                    .post(`/api/threads/${board}`)
                    .send(threadData[0])
                    .end(function (err, res) {
                        const thread1Id = res.body.thread_id;

                        // Add replies to first thread
                        chai.request(server)
                            .post(`/api/replies/${board}`)
                            .send({
                                thread_id: thread1Id,
                                text: 'First reply to first thread',
                                delete_password: 'replypass1'
                            })
                            .end(function () {
                                chai.request(server)
                                    .post(`/api/replies/${board}`)
                                    .send({
                                        thread_id: thread1Id,
                                        text: 'Second reply to first thread',
                                        delete_password: 'replypass2'
                                    })
                                    .end(function () {
                                        // Create second thread
                                        chai.request(server)
                                            .post(`/api/threads/${board}`)
                                            .send(threadData[1])
                                            .end(function (err, res) {
                                                // Create third thread
                                                chai.request(server)
                                                    .post(`/api/threads/${board}`)
                                                    .send(threadData[2])
                                                    .end(function () {
                                                        callback();
                                                    });
                                            });
                                    });
                            });
                    });
            }

            // Create threads and then test retrieval
            createThreadsWithReplies(function () {
                chai.request(server)
                    .get(`/api/threads/${board}`)
                    .end(function (err, res) {
                        assert.isNull(err, 'No error should be returned');

                        // Check response status
                        assert.equal(res.status, 200, 'Response should be 200 OK');

                        // Check response body
                        assert.isArray(res.body, 'Response should be an array');

                        // Verify threads are sorted by most recent
                        assert.isAtMost(res.body.length, 10, 'Should return at most 10 threads');

                        // Verify thread properties
                        res.body.forEach(thread => {
                            assert.property(thread, 'thread_id', 'Thread should have an ID');
                            assert.property(thread, 'board', 'Thread should have a board');
                            assert.property(thread, 'text', 'Thread should have text');
                            assert.property(thread, 'created_on', 'Thread should have creation time');
                            assert.property(thread, 'bumped_on', 'Thread should have last bumped time');

                            // Verify replies
                            assert.property(thread, 'replies', 'Thread should have replies');
                            assert.isArray(thread.replies, 'Replies should be an array');
                            assert.isAtMost(thread.replies.length, 3, 'Should return at most 3 replies');

                            // Verify no sensitive information is returned
                            assert.notProperty(thread, 'delete_password', 'Should not return delete password');
                            assert.notProperty(thread, 'reported', 'Should not return reported status');

                            // Verify reply properties
                            thread.replies.forEach(reply => {
                                assert.property(reply, 'reply_id', 'Reply should have an ID');
                                assert.property(reply, 'text', 'Reply should have text');
                                assert.property(reply, 'created_on', 'Reply should have creation time');

                                // Verify no sensitive information is returned for replies
                                assert.notProperty(reply, 'delete_password', 'Should not return reply delete password');
                                assert.notProperty(reply, 'reported', 'Should not return reply reported status');
                            });
                        });

                        done();
                    });
            });
        });
    });

    suite('DELETE /api/threads/{board} Tests', function () {
        test('Delete a thread with correct password', function (done) {
            const board = 'testBoard';
            const threadData = {
                board: board,
                text: 'Thread to be deleted',
                delete_password: 'correctPassword'
            };

            // Create a thread first
            chai.request(server)
                .post(`/api/threads/${board}`)
                .send(threadData)
                .end(function (err, res) {
                    const threadId = res.body.thread_id;

                    // Then try to delete it
                    chai.request(server)
                        .delete(`/api/threads/${board}`)
                        .send({
                            thread_id: threadId,
                            delete_password: 'correctPassword'
                        })
                        .end(function (err, res) {
                            assert.isNull(err, 'No error should be returned');
                            assert.equal(res.status, 200, 'Should successfully delete thread');
                            assert.deepEqual(res.body, { message: 'Thread deleted successfully' });

                            // Verify thread is actually deleted
                            chai.request(server)
                                .get(`/api/threads/${board}`)
                                .end(function (err, res) {
                                    assert.isArray(res.body, 'Response should be an array');
                                    const deletedThread = res.body.find(t => t.thread_id === threadId);
                                    assert.isUndefined(deletedThread, 'Deleted thread should not exist');

                                    done();
                                });
                        });
                });
        });

        test('Delete thread with incorrect password fails', function (done) {
            const board = 'testBoard';
            const threadData = {
                board: board,
                text: 'Thread to be deleted',
                delete_password: 'correctPassword'
            };

            // Create a thread first
            chai.request(server)
                .post(`/api/threads/${board}`)
                .send(threadData)
                .end(function (err, res) {
                    const threadId = res.body.thread_id;

                    // Try to delete with incorrect password
                    chai.request(server)
                        .delete(`/api/threads/${board}`)
                        .send({
                            thread_id: threadId,
                            delete_password: 'wrongPassword'
                        })
                        .end(function (err, res) {
                            assert.equal(res.status, 403, 'Should return forbidden status');
                            assert.deepEqual(res.body, { error: 'Incorrect delete password' });

                            done();
                        });
                });
        });
    });

    suite('POST /api/replies/{board} Tests', function () {
        test('Add a reply to an existing thread', function (done) {
            const board = 'testBoard';
            const threadData = {
                board: board,
                text: 'Original thread',
                delete_password: 'threadPassword'
            };

            // Create a thread first
            chai.request(server)
                .post(`/api/threads/${board}`)
                .send(threadData)
                .end(function (err, res) {
                    const threadId = res.body.thread_id;

                    // Add a reply to the thread
                    const replyData = {
                        thread_id: threadId,
                        text: 'This is a test reply',
                        delete_password: 'replyPassword'
                    };

                    chai.request(server)
                        .post(`/api/replies/${board}`)
                        .send(replyData)
                        .end(function (err, res) {
                            assert.isNull(err, 'No error should be returned');
                            assert.equal(res.status, 201, 'Should successfully create reply');

                            // Verify reply properties
                            assert.property(res.body, 'reply_id', 'Reply should have an ID');
                            assert.equal(res.body.text, replyData.text, 'Reply text should match');
                            assert.property(res.body, 'created_on', 'Reply should have creation timestamp');

                            // Verify no sensitive information is returned
                            assert.notProperty(res.body, 'delete_password', 'Should not return delete password');
                            assert.notProperty(res.body, 'reported', 'Should not return reported status');

                            done();
                        });
                });
        });
    });
});