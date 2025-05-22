const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// CORS configuration
app.use(cors({
    origin: "*", // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false // Don't allow credentials since we're using wildcard origin
}));

app.use(express.json());

// MongoDB connection
const uri = "mongodb+srv://admin_sid:REDACTED@webcapstone.xgv73pn.mongodb.net/?retryWrites=true&w=majority&appName=webcapstone";
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let isConnected = false;

// Connect to MongoDB
async function connectToMongo() {
    try {
        if (!isConnected) {
            await client.connect();
            await client.db("admin").command({ ping: 1 });
            isConnected = true;
            console.log("Successfully connected to MongoDB!");
        }
        return true;
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        isConnected = false;
        return false;
    }
}

// Health check endpoint
app.get("/", (req, res) => {
    res.json({ status: "ok", message: "Server is running" });
});

// API endpoint to store events
app.post("/api/events", async (req, res) => {
    try {
        const { taskId, events } = req.body;

        // Ensure MongoDB is connected
        if (!isConnected) {
            const connected = await connectToMongo();
            if (!connected) {
                return res
                    .status(500)
                    .json({ error: "Database connection failed" });
            }
        }

        if (!taskId || !events) {
            return res
                .status(400)
                .json({ error: "taskId and events are required" });
        }

        const database = client.db("webcapstone");
        const collection = database.collection("events");

        const documentToInsert = {
            taskId,
            timestamp: new Date(),
            events,
        };

        const result = await collection.insertOne(documentToInsert);

        res.status(201).json({
            success: true,
            message: "Events stored successfully",
            documentId: result.insertedId,
        });
    } catch (error) {
        console.error("Error storing events:", error);
        res.status(500).json({ error: "Failed to store events" });
    }
});

// Start server
app.listen(port, async () => {
    console.log(`Server running on port ${port}`);
    // Connect to MongoDB after server starts
    await connectToMongo();
});

// Handle cleanup on server shutdown
process.on('SIGINT', async () => {
    try {
        await client.close();
        console.log('MongoDB connection closed');
        process.exit(0);
    } catch (error) {
        console.error('Error closing MongoDB connection:', error);
        process.exit(1);
    }
}); 