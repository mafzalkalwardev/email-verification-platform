const dns = require('dns').promises;
const net = require('net');

/**
 * Perform a detailed SMTP verification handshake.
 * @param {string} email - The email to verify
 * @param {string} sender - The sender email (required for MAIL FROM)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<object>} Detailed verification result
 */
async function verifyEmailSMTP(email, sender = 'verify@gmail.com', timeout = 10000) {
    const logs = [];
    const domain = email.split('@')[1];
    let mxRecords = [];

    const addLog = (msg) => {
        const timestamp = new Date().toISOString().split('T')[1].split('Z')[0];
        logs.push(`[${timestamp}] ${msg}`);
    };

    addLog(`Starting verification for: ${email}`);

    // 1. Syntax Check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        addLog('Error: Invalid email syntax');
        return {
            valid: false,
            reason: 'syntax',
            logs,
            details: 'The email address syntax is incorrect'
        };
    }
    addLog('Email address syntax is correct');

    // 2. MX Record Lookup
    try {
        addLog(`Looking up MX records for domain: ${domain}`);
        mxRecords = await dns.resolveMx(domain);
        if (!mxRecords || mxRecords.length === 0) {
            addLog(`Error: No MX records found for ${domain}`);
            return {
                valid: false,
                reason: 'mx',
                logs,
                details: `No MX records found for ${domain}`
            };
        }
        // Sort by priority (lowest number = highest priority)
        mxRecords.sort((a, b) => a.priority - b.priority);
        addLog(`MX records found: ${mxRecords.map(m => `${m.exchange} (Priority ${m.priority})`).join(', ')}`);
    } catch (err) {
        addLog(`Error: DNS lookup failed: ${err.message}`);
        return {
            valid: false,
            reason: 'mx',
            logs,
            details: `DNS lookup failed for ${domain}`
        };
    }

    // 3. SMTP Handshake
    const bestMx = mxRecords[0].exchange;
    addLog(`Attempting connection to: ${bestMx}`);

    return new Promise((resolve) => {
        const socket = net.createConnection(25, bestMx);
        let step = 0;
        let response = '';
        let completed = false;

        socket.setTimeout(timeout);

        const finish = (valid, reason, details) => {
            if (completed) return;
            completed = true;
            socket.destroy();
            resolve({
                valid,
                reason,
                logs,
                details,
                server: bestMx,
                lastResponse: response.trim()
            });
        };

        socket.on('connect', () => {
            addLog(`Connected to ${bestMx} on port 25`);
        });

        socket.on('data', (data) => {
            response = data.toString();
            const code = parseInt(response.substring(0, 3));
            addLog(`Server Response: ${response.trim()}`);

            if (code >= 400) {
                addLog(`Error: Server returned error code ${code}`);
                return finish(false, 'smtp', response.trim());
            }

            switch (step) {
                case 0: // Greeting received, send HELO
                    addLog(`Sending: HELO ${domain}`);
                    socket.write(`HELO ${domain}\r\n`);
                    step++;
                    break;
                case 1: // HELO response, send MAIL FROM
                    addLog(`Sending: MAIL FROM:<${sender}>`);
                    socket.write(`MAIL FROM:<${sender}>\r\n`);
                    step++;
                    break;
                case 2: // MAIL FROM response, send RCPT TO
                    addLog(`Sending: RCPT TO:<${email}>`);
                    socket.write(`RCPT TO:<${email}>\r\n`);
                    step++;
                    break;
                case 3: // RCPT TO response, final check
                    if (code === 250) {
                        addLog(`Success: RCPT TO accepted`);
                        finish(true, null, `Dialog with ${bestMx} succeeded`);
                    } else {
                        addLog(`Failed: RCPT TO rejected`);
                        finish(false, 'smtp', response.trim());
                    }
                    break;
            }
        });

        socket.on('error', (err) => {
            addLog(`Socket Error: ${err.message}`);
            finish(false, 'connection', `Connection error: ${err.message}`);
        });

        socket.on('timeout', () => {
            addLog('Error: Connection timed out');
            finish(false, 'timeout', 'Connection timed out');
        });
    });
}

module.exports = { verifyEmailSMTP };
