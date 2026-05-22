const OpenAI = require('openai');

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Known disposable/temp mail domains
const DISPOSABLE_DOMAINS = new Set([
    'mailinator.com', 'guerrillamail.com', 'temp-mail.org', 'throwam.com',
    '10minutemail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
    'guerrillamailblock.com', 'grr.la', 'guerrillamail.info', 'guerrillamail.biz',
    'guerrillamail.de', 'guerrillamail.net', 'guerrillamail.org', 'spam4.me',
    'tempr.email', 'discard.email', 'maildrop.cc', 'mailnull.com', 'spamgourmet.com',
    'trashmail.me', 'fakeinbox.com', 'getnada.com', 'mohmal.com', 'tempail.com',
    'dispostable.com', 'spamhereplease.com', 'binkmail.com', 'bobmail.info',
    'byom.de', 'chammy.info', 'deadaddress.com', 'despam.it', 'devnullmail.com',
    'dfgh.net', 'digitalsanctuary.com', 'discardmail.com', 'discardmail.de',
    'dodgit.com', 'e4ward.com', 'emailias.com', 'emailisvalid.com', 'emailsensei.com',
    'emailtemporario.com.br', 'emailwarden.com', 'enterto.com', 'example.com',
    'fakemail.net', 'filzmail.com', 'for4.biz', 'fr33mail.info', 'front14.org',
    'gishpuppy.com', 'great-host.in', 'hash.nodemix.org', 'humaility.com',
    'idnxcnknjdfizn.com', 'infocom.zp.ua', 'insorg.org', 'instant-mail.de',
    'koszmail.pl', 'kurzepost.de', 'lhsdv.com', 'ligsb.com', 'litedrop.com',
    'lookugly.com', 'lortemail.dk', 'lovemeleaveme.com', 'lr78.com',
    'maboard.com', 'mail114.net', 'mail1a.de', 'mail21.cc', 'mail2rss.org',
    'mailbucket.org', 'mailchop.com', 'mailexpire.com', 'mailfall.com',
    'mailfreeonline.com', 'mailguard.me', 'mailimate.com', 'mailme.lv',
    'mailme24.com', 'mailmetrash.com', 'mailmoat.com', 'mailnew.com',
    'mailnull.com', 'mailpick.biz', 'mailrock.biz', 'mailscrap.com',
    'mailshuttle.com', 'mailsiphon.com', 'mailslapping.com', 'mailslite.com',
    'mailstem.com', 'mailsucks.me', 'mailtemp.info', 'mailtome.de',
    'mailtothis.com', 'mailzilla.com', 'mbx.cc', 'mega.zik.dj', 'meltmail.com',
    'mezimages.net', 'ministry-of-silly-walks.de', 'mintemail.com',
    'mobileninja.co.uk', 'monumentmail.com', 'msa.minsmail.com', 'mt2009.com',
    'mt2014.com', 'mvat.de', 'mycleaninbox.net', 'myspaceinc.com', 'mytrashmail.com',
    'nervmich.net', 'nervtmich.net', 'netmails.net', 'netzidiot.de', 'nik.pr',
    'no-spam.ws', 'nobulk.com', 'noclickemail.com', 'nogmailspam.info',
    'nomorespamemails.com', 'nonspam.eu', 'nonspammer.de', 'noref.in',
    'nospam.ze.tc', 'nospamfor.us', 'nospammail.net', 'notmailinator.com',
    'nus.edu.sg', 'nwldx.com', 'objectmail.com', 'obobbo.com', 'odnorazovoe.ru',
]);

// Well-known legitimate providers get a trust boost
const TRUSTED_DOMAINS = new Set([
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com',
    'protonmail.com', 'live.com', 'msn.com', 'aol.com', 'mail.com',
    'zoho.com', 'fastmail.com', 'hey.com', 'pm.me',
]);

/**
 * Local heuristic fallback analysis when OpenAI is unavailable.
 * Returns a structured result that mirrors the AI schema.
 */
function localHeuristicAnalysis(email, validationData) {
    const domain = (email.split('@')[1] || '').toLowerCase();
    const isValid = validationData.valid;
    const reason  = validationData.reason || 'none';
    const riskFlags = [];
    const positiveSignals = [];

    // Base score
    let score = 50;

    // Format check
    if (!isValid && (reason === 'regex' || reason === 'typo')) {
        score -= 40;
        riskFlags.push('Invalid email format');
    } else {
        score += 10;
        positiveSignals.push('Valid email format');
    }

    // Disposable check
    const isDisposable = DISPOSABLE_DOMAINS.has(domain) || reason === 'disposable';
    if (isDisposable) {
        score -= 35;
        riskFlags.push('Disposable/temp email domain');
    }

    // MX / domain check
    if (reason === 'mx') {
        score -= 30;
        riskFlags.push('Domain has no MX records (undeliverable)');
    } else if (isValid) {
        score += 10;
        positiveSignals.push('Domain has valid MX records');
    }

    // Trusted provider boost
    const isTrusted = TRUSTED_DOMAINS.has(domain);
    if (isTrusted) {
        score += 20;
        positiveSignals.push(`Trusted provider (${domain})`);
    }

    // Suspicious patterns
    const localPart = email.split('@')[0] || '';
    if (/^\d+$/.test(localPart)) {
        score -= 10;
        riskFlags.push('Numeric-only local part (suspicious)');
    }
    if (localPart.length > 40) {
        score -= 8;
        riskFlags.push('Unusually long local part');
    }
    if (/[+]{2,}/.test(email)) {
        score -= 5;
        riskFlags.push('Unusual special characters');
    }

    // Domain type
    let domainType = 'UNKNOWN';
    if (isDisposable) domainType = 'DISPOSABLE';
    else if (isTrusted) domainType = 'PERSONAL';
    else if (domain.endsWith('.edu')) domainType = 'EDUCATION';
    else if (domain.endsWith('.gov')) domainType = 'GOVERNMENT';
    else if (isValid) domainType = 'BUSINESS';

    const trustScore = Math.min(100, Math.max(0, score));

    let riskLevel;
    if (trustScore >= 75) riskLevel = 'LOW';
    else if (trustScore >= 50) riskLevel = 'MEDIUM';
    else if (trustScore >= 25) riskLevel = 'HIGH';
    else riskLevel = 'CRITICAL';

    let recommendation;
    if (trustScore >= 70) recommendation = 'ACCEPT';
    else if (trustScore >= 40) recommendation = 'REVIEW';
    else recommendation = 'REJECT';

    const statusWord = isValid ? 'valid' : `invalid (${reason})`;
    return {
        trustScore,
        riskLevel,
        domainType,
        isDisposable,
        isCatchAll: false,
        riskFlags,
        positiveSignals,
        aiExplanation: `Heuristic analysis: email is ${statusWord}. Domain "${domain}" classified as ${domainType.toLowerCase()}. Trust score based on format, MX records, disposable detection, and domain reputation.`,
        recommendation,
        aiPowered: false,
    };
}

/**
 * Analyze an email address using OpenAI GPT.
 * Falls back to local heuristic analysis if OpenAI is unavailable.
 * @param {string} email - The email to analyze
 * @param {object} validationData - Result from deep-email-validator
 * @returns {object} AI analysis result
 */
async function analyzeEmailWithAI(email, validationData) {
    const domain  = email.split('@')[1] || '';
    const isValid = validationData.valid;
    const reason  = validationData.reason || 'none';

    const prompt = `You are an AI email security expert. Analyze this email address and provide a JSON risk assessment.

Email: ${email}
Domain: ${domain}
Format Valid: ${isValid}
Validation Failure Reason: ${reason}
Validators: ${JSON.stringify(validationData.validators || {})}

Respond ONLY with a valid JSON object in this exact structure (no markdown, no extra text):
{
  "trustScore": <number 0-100>,
  "riskLevel": "<LOW|MEDIUM|HIGH|CRITICAL>",
  "domainType": "<PERSONAL|BUSINESS|EDUCATION|DISPOSABLE|SUSPICIOUS|UNKNOWN>",
  "isDisposable": <true|false>,
  "isCatchAll": <true|false>,
  "riskFlags": [<array of short risk flag strings, max 4>],
  "positiveSignals": [<array of short positive signal strings, max 3>],
  "aiExplanation": "<2-3 sentence human-readable explanation>",
  "recommendation": "<ACCEPT|REVIEW|REJECT>"
}`;

    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are a precise email security analyst. Always respond with valid JSON only. Never include markdown code blocks or any extra text.'
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 500,
        });

        const responseText = completion.choices[0]?.message?.content?.trim();
        const analysis = JSON.parse(responseText);

        return {
            trustScore:       typeof analysis.trustScore === 'number' ? Math.min(100, Math.max(0, analysis.trustScore)) : 50,
            riskLevel:        ['LOW','MEDIUM','HIGH','CRITICAL'].includes(analysis.riskLevel) ? analysis.riskLevel : 'MEDIUM',
            domainType:       analysis.domainType || 'UNKNOWN',
            isDisposable:     !!analysis.isDisposable,
            isCatchAll:       !!analysis.isCatchAll,
            riskFlags:        Array.isArray(analysis.riskFlags)       ? analysis.riskFlags.slice(0, 4)       : [],
            positiveSignals:  Array.isArray(analysis.positiveSignals) ? analysis.positiveSignals.slice(0, 3) : [],
            aiExplanation:    analysis.aiExplanation || 'AI analysis completed.',
            recommendation:   ['ACCEPT','REVIEW','REJECT'].includes(analysis.recommendation) ? analysis.recommendation : 'REVIEW',
            aiPowered:        true,
        };
    } catch (error) {
        console.warn('⚠️  OpenAI unavailable, using heuristic analysis:', error.message.substring(0, 80));
        // Fall back to smart local heuristic analysis
        return localHeuristicAnalysis(email, validationData);
    }
}

module.exports = { analyzeEmailWithAI };
