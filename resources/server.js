const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration
const corsOptions = {
    origin: '*', // Allow all origins for now
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// MongoDB connection - using environment variable
const uri = process.env.MONGODB_URI;
console.log('MongoDB URI:', uri ? 'URI is set' : 'URI is not set');

if (!uri) {
    console.error('MongoDB URI is not set in environment variables');
    process.exit(1);
}

// Ensure URI starts with mongodb:// or mongodb+srv://
if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    console.error('Invalid MongoDB URI format');
    process.exit(1);
}

const client = new MongoClient(uri);

// Connect to MongoDB
async function connectToMongo() {
    try {
        await client.connect();
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        // Don't exit process on Replit, just log the error
        console.log('Will retry connection...');
    }
}

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// API endpoint to store events
app.post('/api/events', async (req, res) => {
    try {
        console.log('Received request body:', JSON.stringify(req.body, null, 2));
        const { taskId, events } = req.body;

        if (!taskId || !events) {
            console.error('Missing required fields:', { taskId, events });
            return res.status(400).json({ error: 'taskId and events are required' });
        }

        const database = client.db("webcapstone");
        const collection = database.collection("events");

        const documentToInsert = {
            taskId,
            timestamp: new Date(),
            events
        };

        console.log('Inserting document:', JSON.stringify(documentToInsert, null, 2));
        const result = await collection.insertOne(documentToInsert);
        console.log('Insert result:', result);

        res.status(201).json({
            success: true,
            message: 'Events stored successfully',
            documentId: result.insertedId
        });
    } catch (error) {
        console.error('Error storing events:', error);
        res.status(500).json({ error: 'Failed to store events' });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
    // Connect to MongoDB after server starts
    connectToMongo();
}); 