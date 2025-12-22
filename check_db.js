const mongoose = require("mongoose");
const Message = require("./src/models/Message");
require("dotenv").config();

async function check() {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to MongoDB");

    const now = new Date();
    console.log("Current Time (Server):", now.toISOString());

    const unreleased = await Message.find({ isReleased: false });
    console.log(`Found ${unreleased.length} unreleased messages total.`);

    const all = await Message.find().sort({ createdAt: -1 }).limit(10);
    console.log("Last 10 messages:");
    all.forEach(m => {
        console.log(`- ID: ${m._id}, Body: ${m.body}, isReleased: ${m.isReleased}, scheduledAt: ${m.scheduledAt ? m.scheduledAt.toISOString() : "null"}`);
    });

    process.exit();
}

check().catch(err => {
    console.error(err);
    process.exit(1);
});
