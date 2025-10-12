const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`Received request for: ${req.method} ${req.url}`);
  next();
});

function getFieldsQuery(requestedFields, defaultFields) {
    if (requestedFields) {
        const fieldSet = new Set(requestedFields.split(','));
        fieldSet.add('status');
        fieldSet.add('message');
        fieldSet.add('query');
        return Array.from(fieldSet).join(',');
    }
    return defaultFields;
}

function ipToParts(ip) {
  return ip.split('.').map(Number);
}

function summarizeSubnets(ips) {
  // Group by first 3 octets
  const buckets = new Map();
  for (const ip of ips) {
    const [a,b,c,d] = ipToParts(ip);
    const key = `${a}.${b}.${c}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(d);
  }

  const results = [];
  for (const [prefix, hosts] of buckets) {
    const min = Math.min(...hosts);
    const max = Math.max(...hosts);

    // default to Class C (/24-/32)
    let mask = 24;
    // try narrower masks if possible
    for (let prefixLen = 25; prefixLen <= 32; prefixLen++) {
      const size = 1 << (32 - prefixLen); 
      const base = Math.floor(min / size) * size;
      const rangeStart = base;
      const rangeEnd = base + size - 1;
      if (max <= rangeEnd && min >= rangeStart) {
        mask = prefixLen;
      } else {
        break; 
      }
    }

    results.push(`${prefix}.${Math.floor(min / (1 << (32-mask))) * (1 << (32-mask))}/${mask}`);
  }

  return results;
}

/**
 * @route   POST /api/subnets/summarize
 * @desc    Summarize a batch of IP addresses into minimal covering subnets (/24–/32).
 * @access  Public
 */
app.post('/api/subnets/summarize', (req, res) => {
  const { ips } = req.body;

  if (!ips || !Array.isArray(ips) || ips.length === 0) {
    return res.status(400).json({ message: 'Request body must contain an array of IPs.' });
  }

  try {
    const subnets = summarizeSubnets(ips);
    res.status(200).json({ subnets });
  } catch (error) {
    console.error('Error summarizing IPs:', error.message);
    res.status(500).json({ message: 'An error occurred on the server.' });
  }
});

/**
 * @route   GET /api/ip-info/:ip?
 * @desc    Get geolocation info for a specific IP or the requesting IP.
 * @access  Public
 */
app.get('/api/ip-info/:ip?', async (req, res) => {
  const targetIp = req.params.ip || '';
  const defaultFields = 'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query';
  const fields = getFieldsQuery(req.query.fields, defaultFields);
  
  const apiUrl = `http://ip-api.com/json/${targetIp}?fields=${fields}`;
  console.log(`Making request to: ${apiUrl}`); 

  try {
    const response = await axios.get(apiUrl);

    if (response.data.status === 'success') {
      res.status(200).json([response.data]); 
    } else {
      console.error('ip-api returned an error:', response.data.message);
      res.status(400).json({
        message: 'Failed to retrieve IP information.',
        error: response.data.message || 'The external API returned a failure status.'
      });
    }
  } catch (error) {
    console.error('Error fetching data from ip-api:', error.message);
    res.status(500).json({ message: 'An error occurred on the server.' });
  }
});

/**
 * @route   POST /api/ip-info/batch
 * @desc    Get geolocation info for a list of IPs.
 * @access  Public
 */
app.post('/api/ip-info/batch', async (req, res) => {
  const { ips, fields: requestedFields } = req.body;

  if (!ips || !Array.isArray(ips) || ips.length === 0) {
    return res.status(400).json({ message: 'Request body must contain an array of IPs.' });
  }
  
  const defaultFields = 'status,message,query,country,city';
  const fields = getFieldsQuery(requestedFields, defaultFields);
  const apiUrl = `http://ip-api.com/batch?fields=${fields}`;

  try {
    console.log(`Querying batch IPs with fields: ${fields}`);
    const response = await axios.post(apiUrl, ips);
    res.status(200).json(response.data);
  } catch (error) {
    console.error('Error fetching batch data from ip-api:', error.message);
    res.status(500).json({ message: 'An error occurred on the server.' });
  }
});

let REPORT_CONFIG = {
  fields: {
    category: { 
      keywords: ['Category', 'Categories'], 
      label: 'Category', 
      priority: 1,
      enabled: true 
    },
    subCategories: { 
      keywords: ['Sub Categories', 'Sub Category', 'Sub Categor'], 
      label: 'Sub Categories', 
      priority: 2,
      enabled: true 
    },
    deviceAction: { 
      keywords: ['Device Action'], 
      label: 'Device Action', 
      priority: 3,
      enabled: true 
    },
    signature: {
      keywords: ['Signature', 'Signatures', 'Signature Alert'],
      label: 'Signature',
      priority: 4,
      enabled: false
    },
    severity: { 
      keywords: ['Severity'], 
      label: 'Severity', 
      priority: 5,
      enabled: false 
    },
    dateOfIssue: {
      keywords: ['Date of Issue'],
      label: 'Date of Issue',
      priority: 6,
      enabled: false
    },
    startTime: {
      keywords: ['Start Time'],
      label: 'Start Time',
      priority: 7,
      enabled: false
    },
    endTime: {
      keywords: ['End Time'],
      label: 'End Time',
      priority: 8,
      enabled: false
    },
    destinationPort: {
      keywords: ['Destination Port'],
      label: 'Destination Port',
      priority: 9,
      enabled: false
    }
  },
  sections: {
    general: { 
      label: 'Incident General Information', 
      enabled: true 
    },
    incident: { 
      label: 'Incident Information', 
      keywords: ['Incident Information'], 
      enabled: true 
    },
    action: { 
      label: 'Action & Recommendation', 
      keywords: ['Action & Recommendation', 'Action and Recommendation'], 
      enabled: true 
    }
  }
};

/**
 * Extracts field value from text using optimized regex patterns
 */
function extractValue(text, keywords) {
  for (const keyword of keywords) {
    const patterns = [
      `${keyword}\\s*:\\s*([^\\t\\n]+?)(?=\\t|$)`,           // Tabular format
      `\\*\\*${keyword}\\s*:\\*\\*?\\s*([^\\n*]+)`,          // Bold markdown
      `${keyword}\\s*:\\s*(.+?)(?=\\n[A-Z]|$)`               // Simple format
    ];
    
    for (const pattern of patterns) {
      const match = text.match(new RegExp(pattern, 'im'));
      if (match?.[1]?.trim()) return match[1].trim();
    }
  }
  return null;
}

/**
 * Extracts section content and handles duplicates properly
 */
function extractSection(text, keywords, stopBeforeKeywords = []) {
  for (const keyword of keywords) {
    // Build a more precise pattern that stops at known section headers
    const stopPatterns = [
      'Event Time\\s+Source Address',  // Table header
      'Graph',
      'Additional detail',
      ...stopBeforeKeywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    ].join('|');
    
    // Match section header (with or without asterisks/indentation)
    const pattern = new RegExp(
      `^\\s*\\*?\\*?${keyword}\\*?\\*?\\s*$\\s*([\\s\\S]*?)(?=^\\s*(?:${stopPatterns})|$)`,
      'im'
    );
    
    const match = text.match(pattern);
    if (match?.[1]?.trim()) {
      let content = match[1].trim();
      
      // Clean up "Incident Detail" labels
      content = content.replace(/\*\*Incident Detail[^*]*\*\*/, '').trim();
      content = content.replace(/^Incident Detail[:\s]*/, '').trim();
      
      // Remove excessive line breaks but preserve single breaks
      content = content.replace(/\n{3,}/g, '\n\n');
      
      return content;
    }
  }
  return null;
}

/**
 * Finds all occurrences of a section and returns only the first one
 */
function extractFirstOccurrence(text, keywords) {
  let firstMatch = null;
  let firstIndex = Infinity;
  
  for (const keyword of keywords) {
    const pattern = new RegExp(`^\\s*\\*?\\*?${keyword}\\*?\\*?\\s*$`, 'im');
    const match = text.match(pattern);
    if (match && match.index < firstIndex) {
      firstIndex = match.index;
      // Extract content starting from first occurrence
      const startPos = match.index;
      firstMatch = text.substring(startPos);
    }
  }
  
  return firstMatch;
}

/**
 * @route   POST /api/format-report
 * @desc    Formats raw incident text for TheHive with simplified extraction
 * @access  Public
 */
app.post('/api/format-report', (req, res) => {
  const { rawText, customFields, sections } = req.body;

  if (!rawText || typeof rawText !== 'string') {
    return res.status(400).json({ message: 'Request body must contain a "rawText" string.' });
  }

  try {
    // Remove everything after "Graph" or "Additional detail"
    let cleanText = rawText.split(/\n\s*(Graph|Additional detail)/i)[0];
    
    // Merge custom configurations with defaults
    const fieldConfig = customFields ? { ...REPORT_CONFIG.fields, ...customFields } : REPORT_CONFIG.fields;
    const sectionConfig = sections ? { ...REPORT_CONFIG.sections, ...sections } : REPORT_CONFIG.sections;
    
    let output = '';
    const extracted = {};

    // GENERAL INFORMATION SECTION
    if (sectionConfig.general?.enabled !== false) {
      const fields = Object.entries(fieldConfig)
        .filter(([_, config]) => config.enabled !== false)
        .map(([key, config]) => ({
          key,
          ...config,
          value: extractValue(cleanText, config.keywords)
        }))
        .filter(f => f.value)
        .sort((a, b) => a.priority - b.priority);

      if (fields.length > 0) {
        output += `    ${sectionConfig.general.label}\n`;
        fields.forEach(f => {
          output += `${f.label} : ${f.value}\n`;
          extracted[f.key] = { label: f.label, value: f.value };
        });
      }
    }

    // INCIDENT INFORMATION SECTION
    if (sectionConfig.incident?.enabled !== false) {
      const incidentSection = extractFirstOccurrence(cleanText, sectionConfig.incident.keywords);
      if (incidentSection) {
        const content = extractSection(incidentSection, sectionConfig.incident.keywords, sectionConfig.action.keywords);
        if (content) {
          output += `\n    ${sectionConfig.incident.label}\n${content}\n`;
        }
      }
    }

    // ACTION & RECOMMENDATION SECTION
    if (sectionConfig.action?.enabled !== false) {
      const actionSection = extractFirstOccurrence(cleanText, sectionConfig.action.keywords);
      if (actionSection) {
        const content = extractSection(actionSection, sectionConfig.action.keywords);
        if (content) {
          output += `\n    ${sectionConfig.action.label}\n${content}\n`;
        }
      }
    }

    res.status(200).json({ 
      formattedText: output.trimEnd(),
      extractedFields: extracted
    });

  } catch (error) {
    console.error('Error formatting report:', error);
    res.status(500).json({ message: 'An error occurred on the server while formatting the report.' });
  }
});

/**
 * @route   GET /api/format-report/config
 * @desc    Get current report formatting configuration
 * @access  Public
 */
app.get('/api/format-report/config', (req, res) => {
  res.status(200).json(REPORT_CONFIG);
});

/**
 * @route   POST /api/format-report/config
 * @desc    Update report formatting configuration
 * @access  Public
 */
app.post('/api/format-report/config', (req, res) => {
  const { fields, sections } = req.body;
  
  if (!fields && !sections) {
    return res.status(400).json({ message: 'Request body must contain "fields" and/or "sections" object.' });
  }
  
  try {
    if (fields && typeof fields === 'object') {
      Object.assign(REPORT_CONFIG.fields, fields);
    }
    
    if (sections && typeof sections === 'object') {
      Object.assign(REPORT_CONFIG.sections, sections);
    }
    
    res.status(200).json({ 
      message: 'Configuration updated successfully',
      config: REPORT_CONFIG
    });
  } catch (error) {
    console.error('Error updating configuration:', error);
    res.status(500).json({ message: 'An error occurred while updating the configuration.' });
  }
});

/**
 * @route   GET /api/abuseipdb/:ip
 * @desc    Look up IP in AbuseIPDB
 * @access  Public
 */
app.get('/api/abuseipdb/:ip', async (req, res) => {
    const { ip } = req.params;
    const API_KEY = process.env.ABUSEIPDB_API_KEY; 
    
    if (!API_KEY) {
        return res.status(500).json({ 
            error: 'AbuseIPDB API key not configured' 
        });
    }
    
    try {
        const url = new URL('https://api.abuseipdb.com/api/v2/check');
        url.searchParams.append('ipAddress', ip);
        url.searchParams.append('maxAgeInDays', '90');
        url.searchParams.append('verbose', '');
        
        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Key': API_KEY,
                'Accept': 'application/json'
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`AbuseIPDB API error ${response.status}:`, errorText);
            throw new Error(`AbuseIPDB API responded with status: ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log('AbuseIPDB API Response:', JSON.stringify(data, null, 2));
        
        res.json(data);
        
    } catch (error) {
        console.error('AbuseIPDB lookup failed:', error);
        res.status(500).json({ 
            error: 'AbuseIPDB lookup failed',
            message: error.message 
        });
    }
});

app.get('/', (req, res) => {
  res.send('IP Info API Backend (v5 - Simplified Report Formatter) is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});