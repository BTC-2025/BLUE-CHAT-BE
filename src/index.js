// // import express from "express";
// // import dotenv from "dotenv";
// // import cors from "cors";
// // import { createServer } from "http";
// // import { connectDB } from "./db.js";
// // import authRoutes from "./routes/auth.js";
// // import userRoutes from "./routes/users.js";
// // import chatRoutes from "./routes/chats.js";
// // import messageRoutes from "./routes/messages.js";
// // import { mountIO } from "./socket.js";
// const express = require('express')
// const dotenv = require('dotenv')
// const cors = require('cors')
// const {createServer} = require('http')
// const {connectDB} = require('./db.js')
// const authRoutes = require('./routes/auth.js')
// const userRoutes = require('./routes/users.js')
// const chatRoutes = require('./routes/chats.js')
// const messageRoutes = require('./routes/messages.js')
// const {mountIO} = require('./socket.js')

// dotenv.config();

// const app = express();
// app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
// app.use(express.json());

// app.use("/api/auth", authRoutes);
// app.use("/api/users", userRoutes);
// app.use("/api/chats", chatRoutes);
// app.use("/api/messages", messageRoutes);

// await connectDB(process.env.MONGO_URI);

// const httpServer = createServer(app);
// mountIO(httpServer, process.env.CLIENT_ORIGIN);

// httpServer.listen(process.env.PORT, () => {
//   console.log(`✅ Server running on :${process.env.PORT}`);
// });



const express = require('express');
const dotenv = require('dotenv');
dotenv.config(); // ✅ Load env vars early

const cors = require('cors');
const { createServer } = require('http');
const { connectDB } = require('./db.js');
const authRoutes = require('./routes/auth.js');
const userRoutes = require('./routes/users.js');
const chatRoutes = require('./routes/chats.js');
const messageRoutes = require('./routes/messages.js');
const groupRoutes = require('./routes/group.js');
const uploadRoutes = require('./routes/upload.js');
const statusRoutes = require('./routes/status.js');
const callRoutes = require('./routes/calls.js'); // ✅ Added
const notificationRoutes = require('./routes/notifications.js'); // ✅ Added
const adminRoutes = require('./routes/admin.js'); // ✅ Business Admin
const businessRoutes = require('./routes/business.js'); // ✅ Business Accounts
const taskRoutes = require('./routes/taskRoutes.js'); // ✅ Task Management
const { mountIO } = require('./socket.js');

async function startServer() {
  const app = express();

  // ✅ CORS - support multiple origins for dev and production
  const allowedOrigins = process.env.CLIENT_ORIGIN?.split(',') || ['http://localhost:3000'];
  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  }));
  app.use(express.json());

  // Routes
  app.use("/api/auth", authRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/chats", chatRoutes);
  app.use("/api/messages", messageRoutes);
  app.use("/api/groups", groupRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/status", statusRoutes);
  app.use("/api/calls", callRoutes); // ✅ Added
  app.use("/api/notifications", notificationRoutes); // ✅ Added
  app.use("/api/admin", adminRoutes); // ✅ Business Admin
  app.use("/api/business", businessRoutes); // ✅ Business Accounts
  app.use("/api/tasks", taskRoutes); // ✅ Task Management

  // ✅ DB connect (inside async function)
  await connectDB(process.env.MONGO_URI);

  const httpServer = createServer(app);

  // ✅ Init Socket.IO
  const io = mountIO(httpServer, process.env.CLIENT_ORIGIN);
  app.set("io", io); // ✅ Make io accessible in routes

  // ✅ Start Workers
  const { startReleaseWorker } = require('./releaseWorker');
  const { startRetentionWorker } = require('./retentionWorker'); // ✅ Added
  startReleaseWorker(io);
  startRetentionWorker(); // ✅ Added

  // Start server
  httpServer.listen(process.env.PORT, () => {
    console.log(`✅ Server running on :${process.env.PORT}`);
  });
}

// ✅ Run the async server starter
startServer();
