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



// const express = require('express');
// const dotenv = require('dotenv');
// const cors = require('cors');
// const { createServer } = require('http');
// const { connectDB } = require('./db.js');
// const authRoutes = require('./routes/auth.js');
// const userRoutes = require('./routes/users.js');
// const chatRoutes = require('./routes/chats.js');
// const messageRoutes = require('./routes/messages.js');
// const groupRoutes = require('./routes/group.js');
// const uploadRoutes = require('./routes/upload.js');
// const statusRoutes = require('./routes/status.js');
// const { mountIO } = require('./socket.js');

// dotenv.config();

// async function startServer() {
//   const app = express();

//   // ✅ CORS - support multiple origins for dev and production
//   const rawOrigins = [
//     'https://www.bluechat.in',
//     'https://bluechat.in',
//     'http://localhost:3000'
//   ];

//   if (process.env.CLIENT_ORIGIN) {
//     process.env.CLIENT_ORIGIN.split(',').forEach(o => rawOrigins.push(o.trim()));
//   }

//   // Sanitize: lowercase and remove trailing slashes for safer comparison
//   const allowedOrigins = rawOrigins.map(o => o.toLowerCase().replace(/\/$/, ""));

//   app.use(cors({
//     origin: function (origin, callback) {
//       // Allow requests with no origin (mobile apps, curl, etc.)
//       if (!origin) return callback(null, true);

//       const sanitizedOrigin = origin.toLowerCase().replace(/\/$/, "");

//       if (allowedOrigins.includes(sanitizedOrigin)) {
//         callback(null, true);
//       } else {
//         console.warn(`[CORS Blocked] Origin: "${origin}" not in [${allowedOrigins.join(", ")}]`);
//         callback(new Error('Not allowed by CORS'));
//       }
//     },
//     credentials: true,
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//     allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
//   }));
//   app.use(express.json());

//   // Routes
//   app.use("/api/auth", authRoutes);
//   app.use("/api/users", userRoutes);
//   app.use("/api/chats", chatRoutes);
//   app.use("/api/messages", messageRoutes);
//   app.use("/api/groups", groupRoutes);
//   app.use("/api/upload", uploadRoutes);
//   app.use("/api/status", statusRoutes);

//   // ✅ DB connect (inside async function)
//   await connectDB(process.env.MONGO_URI);

//   const httpServer = createServer(app);

//   // ✅ Init Socket.IO
//   const io = mountIO(httpServer, process.env.CLIENT_ORIGIN);

//   // ✅ Start Release Worker (for scheduled messages)
//   const { startReleaseWorker } = require('./releaseWorker');
//   startReleaseWorker(io);

//   // Start server
//   httpServer.listen(process.env.PORT, () => {
//     console.log(`✅ Server running on :${process.env.PORT}`);
//   });
// }

// // ✅ Run the async server starter
// startServer();




// 🔴 MUST BE FIRST — NO EXCEPTIONS
require('dotenv').config();

const express = require('express');
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
const { mountIO } = require('./socket.js');

async function startServer() {
  const app = express();

  // ✅ CORS
  const rawOrigins = [
    'https://www.bluechat.in',
    'https://bluechat.in',
    'http://localhost:3000'
  ];

  if (process.env.CLIENT_ORIGIN) {
    process.env.CLIENT_ORIGIN.split(',').forEach(o => rawOrigins.push(o.trim()));
  }

  const allowedOrigins = rawOrigins.map(o =>
    o.toLowerCase().replace(/\/$/, "")
  );

  app.use(cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);

      const sanitizedOrigin = origin.toLowerCase().replace(/\/$/, "");
      if (allowedOrigins.includes(sanitizedOrigin)) {
        callback(null, true);
      } else {
        console.warn(`[CORS Blocked] ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
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

  await connectDB(process.env.MONGO_URI);

  const httpServer = createServer(app);

  const io = mountIO(httpServer, process.env.CLIENT_ORIGIN);

  const { startReleaseWorker } = require('./releaseWorker');
  startReleaseWorker(io);

  httpServer.listen(process.env.PORT, () => {
    console.log(`✅ Server running on port ${process.env.PORT}`);
  });
}

startServer();
