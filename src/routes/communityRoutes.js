const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Community = require("../models/Community");
const Chat = require("../models/Chat");
const User = require("../models/User");
const { auth } = require("../middleware/auth");

// Helper: Find user by phone
async function findUserByPhoneOr404(phone, res) {
    const u = await User.findOne({ phone });
    if (!u) {
        res.status(404).json({ message: "User with this phone not found" });
        return null;
    }
    return u;
}

// GET /api/communities/my-groups - List groups I admin that are NOT in a community
router.get("/my-groups", auth, async (req, res) => {
    try {
        const groups = await Chat.find({
            isGroup: true,
            admins: req.user.id,
            community: { $exists: false } // Only groups not yet in a community
        }).select("title description avatar participants").lean();

        res.json(groups.map(g => ({
            id: g._id,
            title: g.title,
            participantsCount: g.participants.length
        })));
    } catch (err) {
        console.error("Fetch my groups error:", err);
        res.status(500).json({ message: "Failed to fetch groups" });
    }
});

// POST /api/communities - Create a community
router.post("/", auth, async (req, res) => {
    const { name, description, icon } = req.body;
    if (!name) return res.status(400).json({ message: "Community name is required" });

    try {
        // 1. Create Announcement Group (Sequential - No Transaction)
        const announcementGroup = await Chat.create({
            isGroup: true,
            isAnnouncementGroup: true, // ✅
            title: `${name} Announcements`,
            description: `Official announcements for ${name}`,
            participants: [req.user.id],
            admins: [req.user.id],
            lastMessage: "Community created",
            lastAt: new Date(),
        });

        // 2. Create Community
        const community = await Community.create({
            name,
            description,
            icon,
            owner: req.user.id,
            admins: [req.user.id],
            members: [req.user.id],
            announcementGroup: announcementGroup._id, // Accessing _id directly as it's not an array now
            groups: []
        });

        // 3. Link Announcement Group to Community
        announcementGroup.community = community._id;
        await announcementGroup.save(); // Direct save

        res.status(201).json({
            id: community._id,
            announcementGroupId: announcementGroup._id
        });

    } catch (err) {
        console.error("Community creation error:", err);
        // Note: Without transaction, if step 2 fails, step 1 (group) remains. 
        // In a proper dev env with Replica Set, transactions should be used.
        res.status(500).json({ message: "Failed to create community" });
    }
});

// GET /api/communities - List user's communities
router.get("/", auth, async (req, res) => {
    try {
        // Find all groups the user is in (to check for indirect community membership)
        const userChats = await Chat.find({ participants: req.user.id, isGroup: true }).select('_id');
        const userChatIds = userChats.map(c => c._id);

        const communities = await Community.find({
            $or: [
                { members: req.user.id },
                { groups: { $in: userChatIds } }
            ]
        })
            .populate("announcementGroup", "lastMessage lastAt unread") // simplified population
            .sort({ createdAt: -1 });

        res.json(communities.map(c => ({
            id: c._id,
            name: c.name,
            description: c.description,
            icon: c.icon,
            owner: c.owner,
            amIMember: c.members.map(String).includes(req.user.id) || true, // Treated as member if listed
            amIAdmin: c.admins.map(String).includes(req.user.id)
        })));
    } catch (err) {
        console.error("Fetch communities error:", err);
        res.status(500).json({ message: "Failed to fetch communities" });
    }
});

// GET /api/communities/:id - Get Community Details
router.get("/:id", auth, async (req, res) => {
    try {
        const community = await Community.findById(req.params.id)
            .populate({
                path: "groups",
                select: "title description avatar participants lastMessage lastAt", // Select fields to show
            })
            .populate("announcementGroup", "title description avatar lastMessage lastAt");

        if (!community) return res.status(404).json({ message: "Community not found" });

        // Check membership (Direct member OR member of any linked group)
        const isDirectMember = community.members.map(String).includes(req.user.id);

        // Find groups user is part of within this community
        const userGroupIds = await Chat.find({
            _id: { $in: community.groups },
            participants: req.user.id
        }).distinct('_id'); // get list of group IDs user is in

        const isIndirectMember = userGroupIds.length > 0;

        if (!isDirectMember && !isIndirectMember) {
            return res.status(403).json({ message: "Access denied" });
        }

        res.json({
            id: community._id,
            name: community.name,
            description: community.description,
            icon: community.icon,
            owner: community.owner,
            admins: community.admins,
            membersCount: community.members.length,
            isMember: isDirectMember, // Flag for UI if needed
            announcementGroup: community.announcementGroup ? {
                id: community.announcementGroup._id,
                title: community.announcementGroup.title,
                description: community.announcementGroup.description,
                avatar: community.announcementGroup.avatar,
                lastMessage: community.announcementGroup.lastMessage,
                lastAt: community.announcementGroup.lastAt,
                isGroup: true,
                isAnnouncementGroup: true,
                participantsCount: community.announcementGroup.participants?.length || 0
            } : null,
            groups: community.groups.map(g => ({
                id: g._id,
                title: g.title,
                avatar: g.avatar,
                participantsCount: g.participants.length,
                isGroup: true,
                isMember: userGroupIds.map(String).includes(String(g._id)) // ✅ Flag for UI differentiation
            }))
        });

    } catch (err) {
        console.error("Fetch community details error:", err);
        res.status(500).json({ message: "Failed to fetch community details" });
    }
});

// POST /api/communities/:id/members - Add member
router.post("/:id/members", auth, async (req, res) => {
    const { phone } = req.body;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "Community not found" });

    // Only admins can add members
    if (!community.admins.map(String).includes(req.user.id)) {
        return res.status(403).json({ message: "Admin only" });
    }

    const u = await findUserByPhoneOr404(phone, res);
    if (!u) return;

    if (community.members.map(String).includes(String(u._id))) {
        return res.status(400).json({ message: "User already in community" });
    }

    try {
        // 1. Add to Community
        community.members.push(u._id);
        await community.save();

        // 2. Add to Announcement Group
        const announcementGroup = await Chat.findById(community.announcementGroup);
        if (announcementGroup) {
            announcementGroup.participants.addToSet(u._id);
            await announcementGroup.save();
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Add member error:", err);
        res.status(500).json({ message: "Failed to add member" });
    }
});

// DELETE /api/communities/:id/members - Remove member
router.delete("/:id/members", auth, async (req, res) => {
    const { phone } = req.body;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "Community not found" });

    if (!community.admins.map(String).includes(req.user.id)) {
        return res.status(403).json({ message: "Admin only" });
    }

    const u = await findUserByPhoneOr404(phone, res);
    if (!u) return;

    // Cannot remove owner
    if (String(community.owner) === String(u._id)) {
        return res.status(400).json({ message: "Cannot remove community owner" });
    }

    try {
        // 1. Remove from Community
        community.members.pull(u._id);
        community.admins.pull(u._id); // Also remove admin rights if present
        await community.save();

        // 2. Remove from Announcement Group
        await Chat.updateOne(
            { _id: community.announcementGroup },
            { $pull: { participants: u._id, admins: u._id } }
        );

        // 3. Remove from ALL linked groups
        await Chat.updateMany(
            { _id: { $in: community.groups } },
            { $pull: { participants: u._id, admins: u._id } }
        );

        res.json({ success: true });

    } catch (err) {
        console.error("Remove member error:", err);
        res.status(500).json({ message: "Failed to remove member" });
    }
});

// POST /api/communities/:id/groups - Add existing group
router.post("/:id/groups", auth, async (req, res) => {
    const { groupId } = req.body;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "Community not found" });

    if (!community.admins.map(String).includes(req.user.id)) {
        return res.status(403).json({ message: "Admin only" });
    }

    const group = await Chat.findOne({ _id: groupId, isGroup: true });
    if (!group) return res.status(404).json({ message: "Group not found" });

    // Only group admin can add it to community? Let's assume user must be admin of BOTH.
    if (!group.admins.map(String).includes(req.user.id)) {
        return res.status(403).json({ message: "You must be an admin of the group to add it to a community" });
    }

    if (group.community) {
        return res.status(400).json({ message: "Group already belongs to a community" });
    }

    try {
        community.groups.push(group._id);
        await community.save();

        group.community = community._id;
        await group.save();

        // ✅ Propagate members: Add group participants to Community and Announcement Group
        const newMembers = group.participants;

        await Community.updateOne(
            { _id: community._id },
            { $addToSet: { members: { $each: newMembers } } }
        );

        await Chat.updateOne(
            { _id: community.announcementGroup },
            { $addToSet: { participants: { $each: newMembers } } }
        );

        res.json({ success: true });
    } catch (err) {
        console.error("Add group error:", err);
        res.status(500).json({ message: "Failed to add group" });
    }
});

// POST /api/communities/:id/groups/create - Create and link new group
router.post("/:id/groups/create", auth, async (req, res) => {
    const { title, description } = req.body;
    const community = await Community.findById(req.params.id);
    if (!community) return res.status(404).json({ message: "Community not found" });

    if (!community.admins.map(String).includes(req.user.id)) {
        return res.status(403).json({ message: "Admin only" });
    }

    try {
        const group = await Chat.create({
            isGroup: true,
            title,
            description,
            participants: [req.user.id],
            admins: [req.user.id],
            community: community._id,
            lastMessage: "Group created in community",
            lastAt: new Date()
        });

        community.groups.push(group._id);
        await community.save();

        res.status(201).json({ id: group._id });

    } catch (err) {
        console.error("Create group in community error:", err);
        res.status(500).json({ message: "Failed to create group" });
    }
});

module.exports = router;
