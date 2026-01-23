const express = require('express');
const router = express.Router();
const Business = require('../models/Business');
const Product = require('../models/Product');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

// Register Business
router.post('/register', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        // Check if user already has a business
        const existing = await Business.findOne({ userId });
        if (existing) {
            return res.status(400).json({ message: 'Business already registered' });
        }

        const {
            businessName,
            category,
            description,
            address,
            mapLink,
            email,
            website,
            businessHours,
            logo,
            coverImage
        } = req.body;

        if (!businessName || !category) {
            return res.status(400).json({ message: 'Business name and category required' });
        }

        const business = await Business.create({
            userId,
            businessName,
            category,
            description: description || '',
            address: address || '',
            mapLink: mapLink || '',
            email: email || '',
            website: website || '',
            businessHours: businessHours || {},
            logo: logo || '',
            coverImage: coverImage || '',
            status: 'pending'
        });

        // Update user's isBusiness flag immediately (so UI can reflect it)
        await User.findByIdAndUpdate(userId, {
            isBusiness: true,
            businessId: business._id
        });

        res.status(201).json({ message: 'Business registration submitted for approval', business });
    } catch (error) {
        console.error('Business registration error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get My Business
router.get('/my-business', auth, async (req, res) => {
    try {
        const business = await Business.findOne({ userId: req.user.id })
            .populate('approvedBy', 'username')
            .lean();

        if (!business) {
            return res.status(404).json({ message: 'No business found' });
        }

        res.json(business);
    } catch (error) {
        console.error('Get my business error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update Business Info
router.patch('/update', auth, async (req, res) => {
    try {
        const business = await Business.findOne({ userId: req.user.id });

        if (!business) {
            return res.status(404).json({ message: 'Business not found' });
        }

        // Only allow updates if pending or approved (not rejected)
        if (business.status === 'rejected') {
            return res.status(403).json({ message: 'Cannot update rejected business. Please create a new registration.' });
        }

        const {
            businessName,
            category,
            description,
            address,
            mapLink,
            email,
            website,
            businessHours,
            logo,
            coverImage,
            greetingMessage
        } = req.body;

        console.log('PATCH /update received:', req.body);

        // Update fields
        if (businessName) business.businessName = businessName;
        if (category) business.category = category;
        if (description !== undefined) business.description = description;
        if (address !== undefined) business.address = address;
        if (mapLink !== undefined) business.mapLink = mapLink;
        if (email !== undefined) business.email = email;
        if (website !== undefined) business.website = website;
        if (businessHours !== undefined) business.businessHours = businessHours;
        if (logo !== undefined) business.logo = logo;
        if (coverImage !== undefined) business.coverImage = coverImage;
        if (req.body.greetingMessage !== undefined) business.greetingMessage = req.body.greetingMessage;

        // If business was approved and is being updated, set back to pending
        if (business.status === 'approved') {
            business.status = 'pending';
            business.approvedAt = null;
            business.approvedBy = null;
        }

        await business.save();

        res.json({ message: 'Business updated successfully', business });
    } catch (error) {
        console.error('Update business error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ============ PRODUCT MANAGEMENT ============

// Create Product
router.post('/products', auth, async (req, res) => {
    try {
        const business = await Business.findOne({ userId: req.user.id });

        if (!business) {
            return res.status(404).json({ message: 'Business not found' });
        }

        if (business.status !== 'approved') {
            return res.status(403).json({ message: 'Business must be approved to add products' });
        }

        const { name, description, price, currency, images, category, inStock } = req.body;

        if (!name) {
            return res.status(400).json({ message: 'Product name required' });
        }

        const product = await Product.create({
            businessId: business._id,
            name,
            description: description || '',
            price: price || 0,
            currency: currency || 'USD',
            images: images || [],
            category: category || '',
            inStock: inStock !== undefined ? inStock : true
        });

        res.status(201).json({ message: 'Product created', product });
    } catch (error) {
        console.error('Create product error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get My Products
router.get('/products', auth, async (req, res) => {
    try {
        const business = await Business.findOne({ userId: req.user.id });

        if (!business) {
            return res.status(404).json({ message: 'Business not found' });
        }

        const products = await Product.find({ businessId: business._id })
            .sort({ createdAt: -1 })
            .lean();

        res.json(products);
    } catch (error) {
        console.error('Get products error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update Product
router.patch('/products/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const business = await Business.findOne({ userId: req.user.id });

        if (!business) {
            return res.status(404).json({ message: 'Business not found' });
        }

        const product = await Product.findOne({ _id: id, businessId: business._id });

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const { name, description, price, currency, images, category, inStock } = req.body;

        if (name) product.name = name;
        if (description !== undefined) product.description = description;
        if (price !== undefined) product.price = price;
        if (currency) product.currency = currency;
        if (images !== undefined) product.images = images;
        if (category !== undefined) product.category = category;
        if (inStock !== undefined) product.inStock = inStock;

        await product.save();

        res.json({ message: 'Product updated', product });
    } catch (error) {
        console.error('Update product error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete Product
router.delete('/products/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const business = await Business.findOne({ userId: req.user.id });

        if (!business) {
            return res.status(404).json({ message: 'Business not found' });
        }

        const result = await Product.deleteOne({ _id: id, businessId: business._id });

        if (result.deletedCount === 0) {
            return res.status(404).json({ message: 'Product not found' });
        }

        res.json({ message: 'Product deleted' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get Public Business Products
router.get('/:userId/products', async (req, res) => {
    try {
        const { userId } = req.params;

        const business = await Business.findOne({ userId });

        if (!business) {
            return res.status(404).json({ message: 'Business not found' });
        }

        if (business.status !== 'approved') {
            return res.json([]); // Return empty products list for pending business
        }

        const products = await Product.find({ businessId: business._id, inStock: true })
            .sort({ createdAt: -1 })
            .lean();

        res.json(products);
    } catch (error) {
        console.error('Get business products error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ⚠️ IMPORTANT: This must be the LAST GET route to avoid catching specific routes
// Get Public Business Profile
router.get('/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const business = await Business.findOne({ userId })
            .populate('userId', 'full_name phone avatar')
            .lean();

        if (!business) {
            // Truly NOT found (shouldn't happen if isBusiness is true, but handle it)
            return res.status(404).json({ message: 'Business not found' });
        }

        if (business.status !== 'approved') {
            // Found but not approved -> Return 200 with pending status so frontend doesn't 404
            return res.status(200).json({ status: business.status, businessName: null });
        }

        res.json(business);
    } catch (error) {
        console.error('Get business profile error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
