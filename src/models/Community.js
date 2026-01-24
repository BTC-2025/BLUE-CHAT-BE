const mongoose = require("mongoose");

const communitySchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: "" },
    icon: { type: String, default: "" }, // URL for community icon

    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // The special announcement group auto-created for this community
    announcementGroup: { type: mongoose.Schema.Types.ObjectId, ref: "Chat" },

    // All usage groups linked to this community
    groups: [{ type: mongoose.Schema.Types.ObjectId, ref: "Chat" }],

}, { timestamps: true });

module.exports = mongoose.model("Community", communitySchema);
