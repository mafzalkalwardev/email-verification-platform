const emailValidator = require('deep-email-validator');
const ValidationHistory = require('../models/ValidationHistory');
const { analyzeEmailWithAI } = require('../utils/aiAnalyzer');
const fs = require('fs');
const csv = require('csv-parser');
const xlsx = require('xlsx');

// @desc    Verify single email (with AI analysis)
// @route   POST /api/verify/single
// @access  Private
const verifySingleEmail = async (req, res) => {
    const { email, source = 'single' } = req.body;
    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        // Step 1: Local validation using deep-email-validator
        const validationResult = await emailValidator.validate({
            email: email,
            validateRegex: true,
            validateMx: true,
            validateTypo: true,
            validateDisposable: true,
            validateSMTP: true // Disabled — often blocked by cloud/ISPs
        });

        // Map validation result to a status string
        let statusText = 'unknown';
        if (validationResult.valid) {
            statusText = 'ok';
        } else {
            if (validationResult.reason === 'regex' || validationResult.reason === 'typo') {
                statusText = 'invalid';
            } else if (validationResult.reason === 'disposable') {
                statusText = 'disposable';
            } else if (validationResult.reason === 'mx' || validationResult.reason === 'smtp') {
                statusText = 'invalid';
            } else {
                statusText = 'error';
            }
        }

        // Step 2: AI-powered analysis using OpenAI
        const aiAnalysis = await analyzeEmailWithAI(email, validationResult);

        // Step 3: Combine checks into a detailed validators breakdown
        const validators = {
            regex: {
                valid: validationResult.validators?.regex?.valid ?? (validationResult.reason !== 'regex'),
                reason: validationResult.validators?.regex?.reason || null,
            },
            mx: {
                valid: validationResult.validators?.mx?.valid ?? (validationResult.reason !== 'mx'),
                reason: validationResult.validators?.mx?.reason || null,
            },
            disposable: {
                valid: validationResult.validators?.disposable?.valid ?? (validationResult.reason !== 'disposable'),
                reason: validationResult.validators?.disposable?.reason || null,
            },
            smtp: {
                valid: true, // Disabled
                reason: 'SMTP check (Enabled by cloud providers)',
            },
        };

        // Step 4: Save to history with AI details
        const history = await ValidationHistory.create({
            user: req.user._id,
            email,
            status: statusText,
            source: source,
            details: {
                response: validationResult,
                aiAnalysis,
                validators,
            }
        });

        // Step 5: Return full enriched response
        res.json({
            email,
            status: statusText,
            historyId: history._id,
            validators,
            aiAnalysis,
        });
    } catch (error) {
        console.error('Verify Single Email Error:', error.message);
        res.status(500).json({ message: 'Error verifying email', error: error.message });
    }
};

// @desc    Parse bulk email file and return list of emails
// @route   POST /api/verify/upload-bulk
// @access  Private
const uploadBulkFile = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Please upload a file' });
    }

    const filePath = req.file.path;
    const emails = [];

    try {
        if (req.file.mimetype === 'text/csv' || req.file.originalname.endsWith('.csv')) {
            fs.createReadStream(filePath)
                .pipe(csv({ headers: false }))
                .on('data', (row) => {
                    const email = Object.values(row)[0];
                    if (email && email.includes('@')) emails.push(email.trim());
                })
                .on('end', () => {
                    fs.unlinkSync(filePath);
                    res.json({ emails: [...new Set(emails)] });
                });
        } else if (req.file.originalname.endsWith('.xlsx')) {
            const workbook = xlsx.readFile(filePath);
            const sheet_name_list = workbook.SheetNames;
            const xlData = xlsx.utils.sheet_to_json(workbook.Sheets[sheet_name_list[0]], { header: 1 });

            xlData.forEach(row => {
                if (row && row.length > 0) {
                    const email = row[0];
                    if (email && typeof email === 'string' && email.includes('@')) {
                        emails.push(email.trim());
                    }
                }
            });
            fs.unlinkSync(filePath);
            res.json({ emails: [...new Set(emails)] });
        } else {
            fs.unlinkSync(filePath);
            return res.status(400).json({ message: 'Unsupported file format' });
        }
    } catch (error) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.status(500).json({ message: 'Error parsing file', error: error.message });
    }
};

module.exports = { verifySingleEmail, uploadBulkFile };
