const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod = null;

const connectDB = async () => {
    // First try Atlas (or whatever MONGO_URI is set to)
    if (process.env.MONGO_URI) {
        try {
            const conn = await mongoose.connect(process.env.MONGO_URI, {
                serverSelectionTimeoutMS: 5000, // fail fast if unreachable
            });
            console.log(`✅ MongoDB Atlas Connected: ${conn.connection.host}`);
            return;
        } catch (error) {
            console.warn(`⚠️  Atlas connection failed (${error.message})`);
            console.log('🔄 Falling back to in-memory MongoDB...');
        }
    }

    // Fallback: spin up an in-memory MongoDB instance
    try {
        mongod = await MongoMemoryServer.create();
        const uri = mongod.getUri();
        const conn = await mongoose.connect(uri);
        console.log(`✅ In-Memory MongoDB running: ${conn.connection.host}`);
        console.log('ℹ️  Note: Data will NOT persist between server restarts in fallback mode.');
    } catch (fallbackError) {
        console.error(`❌ In-memory MongoDB also failed: ${fallbackError.message}`);
        process.exit(1);
    }
};

// Gracefully stop the in-memory server when the process exits
process.on('SIGINT', async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
    process.exit(0);
});

module.exports = connectDB;
