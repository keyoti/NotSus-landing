// server.js
require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const authRoutes = require('./routes/auth');
const { authenticateToken, requireAdmin } = require('./auth');
const { sendVerificationEmail } = require('./services/email');

const app = express();

const corsOptions = {
    origin: [
        'https://www.notsus.net', 
        'https://notsus.net',
        'http://localhost:3000',
        'http://127.0.0.1:3000'
    ],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// Serve static files from the root directory with caching headers
app.use(express.static(path.join(__dirname), {
    maxAge: '1y', // Cache static files for 1 year
    etag: true, // Enable ETag for better caching
    lastModified: true // Enable Last-Modified headers
}));

// Root route to serve the index.html page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Downloads
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));

// Auth routes
app.use('/auth', authRoutes);

// Validation middleware
const validateFeedback = (req, res, next) => {
    const { email, concerns } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            error: 'Validation error',
            message: 'Email is required'
        });
    }

    // Only validate concerns array if present
    if (concerns && !Array.isArray(concerns)) {
        return res.status(400).json({
            success: false,
            error: 'Validation error',
            message: 'Concerns must be an array'
        });
    }

    next();
};

// API endpoint for submitting feedback - Updated to handle all fields
app.post('/api/feedback', validateFeedback, async (req, res, next) => {
    try {
        console.log('Received feedback submission:', req.body);
        
        const result = await db.transaction(async (client) => {
            const {
                name,
                email,
                concerns,
                gains,
                otherDescription,
                gainsDescription
            } = req.body;

            console.log('Processing values:', {
                name,
                email,
                concerns,
                gains,
                otherDescription,
                gainsDescription
            });

            const query = `
                INSERT INTO user_feedback (
                    name,
                    email,
                    screen_time_addiction,
                    consumptive_habits,
                    inappropriate_content,
                    bad_influences,
                    safety,
                    false_information,
                    social_distortion,
                    other_concern,
                    other_description
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING id;
            `;

            const values = [
                name,
                email,
                concerns?.includes('screen-time'),
                concerns?.includes('consumptive'),
                concerns?.includes('inappropriate'),
                concerns?.includes('influences'),
                concerns?.includes('safety'),
                concerns?.includes('false-info'),
                concerns?.includes('social'),
                concerns?.includes('other'),
                otherDescription
            ];

            console.log('Executing query with values:', values);
            
            try {
                const queryResult = await client.query(query, values);
                console.log('Query result:', queryResult);
                return queryResult;
            } catch (dbError) {
                console.error('Database error details:', {
                    code: dbError.code,
                    message: dbError.message,
                    detail: dbError.detail,
                    table: dbError.table,
                    constraint: dbError.constraint
                });
                throw dbError;
            }
        });

        console.log('Transaction completed successfully:', result);

        // Create email verification token (24h) and send verification email
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await db.query(`
            INSERT INTO email_verification_tokens (email, token, expires_at)
            VALUES ($1, $2, $3)
        `, [req.body.email, verificationToken, expiresAt]);

        await sendVerificationEmail(req.body.email, verificationToken);

        res.json({
            success: true,
            id: result.rows[0].id,
            requireVerification: true,
            message: 'check_email'
        });
    } catch (err) {
        console.error('Full error details:', {
            message: err.message,
            stack: err.stack,
            code: err.code,
            detail: err.detail
        });
        res.status(500).json({
            success: false,
            error: 'Failed to save feedback',
            detail: err.message
        });
    }
});

// API endpoint for tracking download attempts (email or token for verified users)
app.post('/api/track-download', async (req, res) => {
    try {
        const { email, token, platform, action, browserInfo } = req.body;
        let resolvedEmail = email;
        if (token && !email) {
            const row = await db.query(
                'SELECT email FROM download_tokens WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP',
                [token]
            );
            if (row.rows.length > 0) resolvedEmail = row.rows[0].email;
        }

        console.log('Tracking download:', { email: resolvedEmail, platform, action });

        await db.query(`
            INSERT INTO download_tracking (
                email,
                platform,
                action,
                browser_name,
                browser_version,
                os_name,
                os_version,
                user_agent
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            resolvedEmail || null,
            platform,
            action,
            (browserInfo && browserInfo.browser && browserInfo.browser.name) || 'Unknown',
            (browserInfo && browserInfo.browser && browserInfo.browser.version) || 'Unknown',
            (browserInfo && browserInfo.os && browserInfo.os.name) || 'Unknown',
            (browserInfo && browserInfo.os && browserInfo.os.version) || 'Unknown',
            (browserInfo && browserInfo.userAgent) || ''
        ]);

        res.json({ success: true });
    } catch (err) {
        console.error('Error tracking download:', err);
        res.json({ success: true });
    }
});

// Admin endpoint to get feedback data
app.get('/api/admin/feedback', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const dateFilter = req.query.date;

        // Get submissions
        let query = `
            SELECT *
            FROM user_feedback
        `;

        if (dateFilter) {
            query += ` WHERE DATE(created_at) = $1`;
        }

        query += ` ORDER BY created_at DESC`;

        const result = await db.query(query, dateFilter ? [dateFilter] : []);

        // Get statistics
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE DATE(created_at) = CURRENT_DATE) as today,
                CASE 
                    WHEN COUNT(*) FILTER (WHERE screen_time_addiction) > COUNT(*) FILTER (WHERE safety) THEN 'Screen Time'
                    WHEN COUNT(*) FILTER (WHERE safety) > COUNT(*) FILTER (WHERE inappropriate_content) THEN 'Safety'
                    ELSE 'Content'
                END as top_concern
            FROM user_feedback;
        `;

        const statsResult = await db.query(statsQuery);

        res.json({
            success: true,
            submissions: result.rows,
            stats: {
                total: statsResult.rows[0].total,
                today: statsResult.rows[0].today,
                topConcern: statsResult.rows[0].top_concern
            }
        });
    } catch (err) {
        console.error('Error fetching feedback:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch feedback data'
        });
    }
});

// NEW: Admin endpoint to view download statistics
app.get('/api/admin/downloads', authenticateToken, requireAdmin, async (req, res) => {
    try {
        // Get download statistics
        const statsQuery = `
            SELECT 
                platform,
                action,
                COUNT(*) as count,
                MAX(created_at) as last_attempt
            FROM download_tracking
            GROUP BY platform, action
            ORDER BY platform, action
        `;

        const statsResult = await db.query(statsQuery);

        // Get recent download attempts
        const recentQuery = `
            SELECT
                id,
                email,
                platform,
                action,
                browser_name,
                browser_version,
                os_name,
                os_version,
                created_at
            FROM download_tracking
            ORDER BY created_at DESC
            LIMIT 50
        `;

        const recentResult = await db.query(recentQuery);

        res.json({
            success: true,
            stats: statsResult.rows,
            recent: recentResult.rows
        });
    } catch (err) {
        console.error('Error fetching download stats:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch download statistics'
        });
    }
});

// Admin endpoint to export all completed downloads (full historical data)
app.get('/api/admin/downloads/export', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const completedDownloadsQuery = `
            SELECT
                id,
                email,
                platform,
                action,
                browser_name,
                browser_version,
                os_name,
                os_version,
                user_agent,
                created_at
            FROM download_tracking
            WHERE action = 'complete'
            ORDER BY created_at DESC
        `;

        const result = await db.query(completedDownloadsQuery);

        res.json({
            success: true,
            downloads: result.rows
        });
    } catch (err) {
        console.error('Error exporting completed downloads:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to export completed download data'
        });
    }
});

app.get('/admin', authenticateToken, requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Verify email: validate token, mark used, create download token, redirect to home with download_token
const BASE_URL = process.env.BASE_URL || 'https://www.notsus.net';
app.get('/verify-email', async (req, res) => {
    const { token } = req.query;
    if (!token) {
        return res.redirect(`${BASE_URL}/?verify=missing`);
    }
    try {
        const row = await db.query(`
            SELECT id, email FROM email_verification_tokens
            WHERE token = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        `, [token]);
        if (row.rows.length === 0) {
            return res.redirect(`${BASE_URL}/?verify=invalid`);
        }
        const { id, email } = row.rows[0];
        await db.query(`UPDATE email_verification_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = $1`, [id]);

        const downloadToken = crypto.randomBytes(32).toString('hex');
        const downloadExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.query(`
            INSERT INTO download_tokens (email, token, expires_at) VALUES ($1, $2, $3)
        `, [email, downloadToken, downloadExpiresAt]);

        const downloadNowUrl = `${BASE_URL}/download-now?token=${encodeURIComponent(downloadToken)}`;
        return res.redirect(downloadNowUrl);
    } catch (err) {
        console.error('Verify email error:', err);
        return res.redirect(`${BASE_URL}/?verify=error`);
    }
});

// Dedicated download page: only shown when token is valid (works regardless of caching/subdomain)
app.get('/download-now', async (req, res) => {
    const token = req.query.token;
    if (!token) {
        return res.redirect(`${BASE_URL}/?download=token_required`);
    }
    try {
        const tokenRow = await db.query(`
            SELECT email FROM download_tokens
            WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP
        `, [token]);
        if (tokenRow.rows.length === 0) {
            return res.redirect(`${BASE_URL}/?download=invalid`);
        }
        const tokenEnc = encodeURIComponent(token);
        const downloadLinks = [
            { platform: 'windows', label: 'Download for Windows' },
            { platform: 'mac', label: 'Download for Mac (Apple Silicon)' },
            { platform: 'macIntel', label: 'Download for Mac (Intel)' },
            { platform: 'linux', label: 'Download for Linux' }
        ].map(({ platform, label }) => ({
            href: `/download/${platform}?token=${tokenEnc}`,
            label
        }));
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Download NotSus Browser | NotSus.net</title>
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-JP7D4XPL7X"></script>
    <link rel="stylesheet" href="/styles.css">
    <link rel="icon" type="image/png" href="/favicon.png">
</head>
<body class="page-download-now">
    <header>
        <div class="header-container">
            <div class="header-left">
                <a href="/"><img src="/public/logo.png" height="40" width="40" alt="NotSus Logo" class="logo-img"></a>
                <div class="logo-text-container">
                    <a href="/" style="color:inherit;text-decoration:none;"><div class="logo">NotSus.net</div></a>
                    <h6 class="logo-tagline">The better browser for kids.</h6>
                </div>
            </div>
        </div>
    </header>
    <main class="container download-now-main">
        <h1 class="download-now-title">Thank you for verifying your email</h1>
        <p class="download-now-subtitle">Download the NotSus browser for a safer browsing experience for your kids.</p>
        <div class="download-buttons-wrap">
            ${downloadLinks.map(({ href, label }) => `<a href="${href}" class="download-button" onclick="gtag('event', 'click', { event_category: 'installer_download', event_label: '${label}' });"><span>${label}</span></a>`).join('\n            ')}
        </div>
        <p style="text-align: center; margin-top: 1rem; font-size: 0.9rem; opacity: 0.8;">*We're working on tablet and mobile versions, we will let you know when they are available.</p>
        <p class="download-now-back"><a href="/" style="color: var(--secondary-accent);">Back to home</a></p>
    </main>
</body>
</html>`;
        res.type('html').send(html);
    } catch (err) {
        console.error('Downloads page error:', err);
        return res.redirect(`${BASE_URL}/?download=error`);
    }
});

// Download endpoint: requires valid download_token (one token grants access to all platforms)
app.get('/download/:platform', async (req, res) => {
    const { platform } = req.params;
    const downloadToken = req.query.token;

    const downloadUrls = {
        windows: 'https://download.notsus.net/NotSus_Browser_2.1.1.exe',
        mac: 'https://download.notsus.net/NotSus_Browser-2.1.1-arm64.dmg',
        macIntel: 'https://download.notsus.net/NotSus_Browser-2.1.1.dmg',
        linux: 'https://download.notsus.net/notsusbrowser_2.1.1_amd64.deb'
    };

    if (!downloadUrls[platform]) {
        return res.status(404).json({
            success: false,
            error: 'Platform not supported'
        });
    }
    if (!downloadUrls[platform] || downloadUrls[platform].trim() === '') {
        return res.status(503).json({
            success: false,
            error: 'Download not available',
            message: `The ${platform} download is not yet available. Please check back soon.`
        });
    }

    if (!downloadToken) {
        return res.redirect(`${BASE_URL}/?download=token_required`);
    }

    try {
        const tokenRow = await db.query(`
            SELECT email FROM download_tokens
            WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP
        `, [downloadToken]);
        if (tokenRow.rows.length === 0) {
            return res.redirect(`${BASE_URL}/?download=invalid`);
        }
        const email = tokenRow.rows[0].email;

        await db.query(`
            INSERT INTO app_downloads (platform, email, download_time, user_agent, ip_address)
            VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4)
        `, [platform, email, req.headers['user-agent'], req.headers['x-forwarded-for'] || req.connection.remoteAddress]);

        await db.query(`
            INSERT INTO download_tracking (email, platform, action, browser_name, browser_version, os_name, os_version, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [email, platform, 'complete', 'Unknown', 'Unknown', 'Unknown', 'Unknown', req.headers['user-agent']]);

        res.redirect(downloadUrls[platform]);
    } catch (err) {
        console.error('Error tracking download:', err);
        res.redirect(downloadUrls[platform]);
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.json({ status: 'healthy' });
    } catch (err) {
        res.status(503).json({ status: 'unhealthy', error: err.message });
    }
});

// Error handling middleware - must be last
app.use((err, req, res, next) => {
    console.error(err.stack);

    if (err instanceof db.DatabaseError) {
        return res.status(500).json({
            success: false,
            error: 'Database error',
            message: err.message,
            code: err.code
        });
    }

    res.status(500).json({
        success: false,
        error: 'Server error',
        message: err.message
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM received. Closing database connections...');
    await db.end();
    process.exit(0);
});
