const mongoose = require('mongoose');

const connectedAppSchema = new mongoose.Schema({
    chatOriginId: { type: String, required: true, unique: true, index: true }, // e.g. 'ecommerce-client-001'
    name: { type: String, required: true }, // e.g. 'My E-com Store'
    icon: { type: String },
    apiKey: { type: String }, // Optional: for server-to-server auth later
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional: link to a system admin
    registeredAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ConnectedApp', connectedAppSchema);
