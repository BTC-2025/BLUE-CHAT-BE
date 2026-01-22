const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const Admin = require('../models/Admin');

async function createInitialAdmin() {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ username: 'admin' });

        if (existingAdmin) {
            console.log('⚠️  Admin user already exists');
            process.exit(0);
        }

        // Get credentials from environment or use defaults
        const username = process.env.ADMIN_USERNAME || 'admin';
        const password = process.env.ADMIN_PASSWORD || 'admin123';
        const email = process.env.ADMIN_EMAIL || 'admin@chatapp.com';

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create admin
        await Admin.create({
            username,
            password_hash: hashedPassword,
            email
        });

        console.log('✅ Admin user created successfully');
        console.log(`   Username: ${username}`);
        console.log(`   Password: ${password}`);
        console.log(`   Email: ${email}`);
        console.log('');
        console.log('⚠️  Please change the default password after first login!');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating admin:', error);
        process.exit(1);
    }
}

createInitialAdmin();
