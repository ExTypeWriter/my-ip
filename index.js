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

// Configuration object for field extraction
let FIELD_CONFIG = {
    // General Information fields
    'category': {
        keywords: ['Category'],
        section: 'general',
        outputLabel: 'Category'
    },
    'subCategories': {
        keywords: ['Sub Categories', 'Sub Category', 'Sub Categor'],
        section: 'general',
        outputLabel: 'Sub Categories'
    },
    'deviceAction': {
        keywords: ['Device Action'],
        section: 'general',
        outputLabel: 'Device Action'
    },
    'severity': {
        keywords: ['Severity'],
        section: 'general',
        outputLabel: 'Severity'
    },
    'dateOfIssue': {
        keywords: ['Date of Issue'],
        section: 'general',
        outputLabel: 'Date of Issue'
    },
    'startTime': {
        keywords: ['Start Time'],
        section: 'general',
        outputLabel: 'Start Time'
    },
    'endTime': {
        keywords: ['End Time'],
        section: 'general',
        outputLabel: 'End Time'
    },
    'destinationPort': {
        keywords: ['Destination Port'],
        section: 'general',
        outputLabel: 'Destination Port'
    }
};

/**
 * Extracts field value from text using multiple strategies
 */
function extractFieldValue(text, fieldConfig) {
    const { keywords } = fieldConfig;
    
    for (const keyword of keywords) {
        const boldPattern = new RegExp(`\\*\\*${keyword}\\s*:\\s*\\*\\*\\s*([^\\n*]+)`, 'i');
        let match = text.match(boldPattern);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
        
        const nextLinePattern = new RegExp(`\\*\\*${keyword}\\s*:\\*\\*\\s*\\n\\s*([^\\n*]+)`, 'i');
        match = text.match(nextLinePattern);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
        
        const simplePattern = new RegExp(`^.*${keyword}\\s*:(.*)$`, 'm');
        match = text.match(simplePattern);
        if (match && match[1]) {
            const genericPattern = /(.*?)(?:\s+[A-Za-z ]+\s*:|$)/;
            const valueMatch = match[1].match(genericPattern);
            if (valueMatch && valueMatch[1]) {
                return valueMatch[1].trim();
            }
        }
        
        const multiLinePattern = new RegExp(`\\*\\*${keyword}\\s*:\\*\\*\\s*\\n([\\s\\S]*?)(?=\\*\\*[^*]+:\\*\\*|$)`, 'i');
        match = text.match(multiLinePattern);
        if (match && match[1].trim()) {
            return match[1].trim().replace(/\n\s*\n/g, '\n');
        }
    }
    
    return null;
}

/**
 * Extracts incident information section
 */
function extractIncidentInformation(text) {
    // Look for "Incident Information" section
    const patterns = [
        /\*\*Incident Information\*\*\s*([\s\S]*?)\s*(?:\*\*Event Time\*\*|\*\*Action & Recommendation\*\*|$)/,
        /Incident Information\s*([\s\S]*?)\s*(?:Event Time|Action & Recommendation|$)/
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1].trim()) {
            let content = match[1].replace(/\*\*Incident Detail[^*]*\*\*/, "").trim();
            content = content.replace(/Incident Detail:/, "").trim();
            if (content) {
                return content;
            }
        }
    }
    
    return null;
}

/**
 * Extracts action and recommendation section
 */
function extractActionRecommendation(text) {
    const patterns = [
        /\*\*Action & Recommendation\*\*\s*([\s\S]*)/,
        /Action & Recommendation\s*([\s\S]*)/
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1].trim()) {
            return match[1].trim().replace(/\n\s*\n/g, "\n");
        }
    }
    
    return null;
}

/**
 * @route   POST /api/format-report
 * @desc    Formats raw incident text for TheHive with configurable field extraction.
 * @access  Public
 */
app.post('/api/format-report', (req, res) => {
    const { rawText, customFields } = req.body;

    if (!rawText || typeof rawText !== 'string') {
        return res.status(400).json({ message: 'Request body must contain a "rawText" string.' });
    }

    try {
        const cutoffRegex = /\n\s*(Graph|Additional detail)/i;
        const cutoffMatch = rawText.match(cutoffRegex);
        const textToParse = cutoffMatch ? rawText.substring(0, cutoffMatch.index) : rawText;

        let formattedString = "";
        
        const fieldConfig = customFields ? { ...FIELD_CONFIG, ...customFields } : FIELD_CONFIG;
        
        // Extract general information fields
        const extractedFields = {};
        let hasGeneralInfo = false;
        
        for (const [fieldKey, config] of Object.entries(fieldConfig)) {
            if (config.section === 'general') {
                const value = extractFieldValue(textToParse, config);
                if (value) {
                    extractedFields[fieldKey] = {
                        label: config.outputLabel,
                        value: value
                    };
                    hasGeneralInfo = true;
                }
            }
        }
        
        // Format general information section
        if (hasGeneralInfo) {
            formattedString += "    Incident General Information\n";
            
            const fieldOrder = ['category', 'subCategories', 'deviceAction', 'severity', 'dateOfIssue', 'startTime', 'endTime', 'destinationPort'];
            
            for (const fieldKey of fieldOrder) {
                if (extractedFields[fieldKey]) {
                    formattedString += `${extractedFields[fieldKey].label} : ${extractedFields[fieldKey].value}\n`;
                }
            }
            
            for (const [fieldKey, field] of Object.entries(extractedFields)) {
                if (!fieldOrder.includes(fieldKey)) {
                    formattedString += `${field.label} : ${field.value}\n`;
                }
            }
        }

        // Extract and format incident information
        const incidentInfo = extractIncidentInformation(textToParse);
        if (incidentInfo) {
            formattedString += "\n    Incident Information\n";
            formattedString += `${incidentInfo}\n`;
        }

        // Extract and format action & recommendation
        const actionRecommendation = extractActionRecommendation(textToParse);
        if (actionRecommendation) {
            formattedString += "\n    Action & Recommendation\n";
            formattedString += `${actionRecommendation}\n`;
        }

        res.status(200).json({ 
            formattedText: formattedString.trimEnd(),
            extractedFields: extractedFields // For debugging/validation
        });

    } catch (error) {
        console.error('Error formatting report:', error);
        res.status(500).json({ message: 'An error occurred on the server while formatting the report.' });
    }
});

/**
 * @route   POST /api/format-report/config
 * @desc    Update field configuration for report formatting
 * @access  Public
 */
app.post('/api/format-report/config', (req, res) => {
    const { fieldConfig } = req.body;
    
    if (!fieldConfig || typeof fieldConfig !== 'object') {
        return res.status(400).json({ message: 'Request body must contain a "fieldConfig" object.' });
    }
    
    try {
        // Merge new configuration with existing
        Object.assign(FIELD_CONFIG, fieldConfig);
        
        res.status(200).json({ 
            message: 'Field configuration updated successfully',
            currentConfig: FIELD_CONFIG
        });
    } catch (error) {
        console.error('Error updating field configuration:', error);
        res.status(500).json({ message: 'An error occurred while updating the configuration.' });
    }
});

/**
 * @route   GET /api/format-report/config
 * @desc    Get current field configuration
 * @access  Public
 */
app.get('/api/format-report/config', (req, res) => {
    res.status(200).json(FIELD_CONFIG);
});

app.get('/', (req, res) => {
  res.send('IP Info API Backend (v3 - Enhanced Format Report) is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});