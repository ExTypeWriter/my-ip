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

let FIELD_CONFIG = {
    // General Information fields
    'category': {
        keywords: ['Category','Categories'],
        section: 'general',
        outputLabel: 'Category',
        enabled: true,
        priority: 1
    },
    'subCategories': {
        keywords: ['Sub Categories', 'Sub Category', 'Sub Categor','Sub Categories:','Sub Category:'],
        section: 'general',
        outputLabel: 'Sub Categories',
        enabled: true,
        priority: 2
    },
    'deviceAction': {
        keywords: ['Device Action'],
        section: 'general',
        outputLabel: 'Device Action',
        enabled: true,
        priority: 3
    },
    'signature': {
        keywords: ['Signature','Signatures','Signature Alert'],
        section: 'general',
        outputLabel: 'Signature',
        enabled: true,
        priority: 3
    },
    'eventClassID': {
        keywords: ['Device Event Class ID','Event Class ID'],
        section: 'general',
        outputLabel: 'Event Class ID',
        enabled: true,
        priority: 4
    },
    
    'severity': {
        keywords: ['Severity'],
        section: 'general',
        outputLabel: 'Severity',
        enabled: false,
        priority: 4
    },
    'dateOfIssue': {
        keywords: ['Date of Issue'],
        section: 'general',
        outputLabel: 'Date of Issue',
        enabled: false,
        priority: 5
    },
    'startTime': {
        keywords: ['Start Time'],
        section: 'general',
        outputLabel: 'Start Time',
        enabled: false,
        priority: 6
    },
    'endTime': {
        keywords: ['End Time'],
        section: 'general',
        outputLabel: 'End Time',
        enabled: false,
        priority: 7
    },
    'destinationPort': {
        keywords: ['Destination Port'],
        section: 'general',
        outputLabel: 'Destination Port',
        enabled: false,
        priority: 8
    }
};

// Section configuration
let SECTION_CONFIG = {
    general: { enabled: true, label: 'Incident General Information' },
    incidentInfo: { enabled: true, label: 'Incident Information' },
    actionRecommendation: { enabled: true, label: 'Action & Recommendation' }
};

/**
 * Extracts field value from text using multiple strategies
 */
/**
 * Extracts field value from text using multiple strategies
 */
function extractFieldValue(text, fieldConfig) {
    const { keywords } = fieldConfig;
    
    for (const keyword of keywords) {
        // Pattern 1: Tabular format - "Keyword :" followed by tab/spaces then value, then tab/spaces then next field
        // Example: "Category : 	Inappropriate Usage	Sub Category:	allowed"
        const tabularPattern = new RegExp(`${keyword}\\s*:\\s*([^\\t\\n]+?)(?=\\s*\\t[A-Za-z\\s]+\\s*:|\\s*$)`, 'i');
        let match = text.match(tabularPattern);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
        
        // Pattern 2: **Keyword :** value (same line, no closing **)
        const sameLineNoClosing = new RegExp(`\\*\\*${keyword}\\s*:\\*\\*?\\s*([^\\n*]+)`, 'i');
        match = text.match(sameLineNoClosing);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
        
        // Pattern 3: **Keyword :** \n value (next line, no closing **)
        const nextLineNoClosing = new RegExp(`\\*\\*${keyword}\\s*:\\*\\*?\\s*\\n\\s*([^\\n*]+)`, 'i');
        match = text.match(nextLineNoClosing);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
        
        // Pattern 4: **Keyword : ** value (original bold pattern)
        const boldPattern = new RegExp(`\\*\\*${keyword}\\s*:\\s*\\*\\*\\s*([^\\n*]+)`, 'i');
        match = text.match(boldPattern);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
        
        // Pattern 5: **Keyword :** ** \n value (next line with closing **)
        const nextLinePattern = new RegExp(`\\*\\*${keyword}\\s*:\\*\\*\\s*\\n\\s*([^\\n*]+)`, 'i');
        match = text.match(nextLinePattern);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
        
        // Pattern 6: Simple line-based pattern - "Keyword : value" on its own line
        const simpleLinePattern = new RegExp(`^\\s*${keyword}\\s*:\\s*(.+?)\\s*$`, 'm');
        match = text.match(simpleLinePattern);
        if (match && match[1].trim()) {
            return match[1].trim();
        }
        
        // Pattern 7: Generic pattern for fallback
        const simplePattern = new RegExp(`${keyword}\\s*:(.*)$`, 'm');
        match = text.match(simplePattern);
        if (match && match[1]) {
            const genericPattern = /(.*?)(?:\s+[A-Za-z ]+\s*:|$)/;
            const valueMatch = match[1].match(genericPattern);
            if (valueMatch && valueMatch[1]) {
                return valueMatch[1].trim();
            }
        }
        
        // Pattern 8: Multi-line pattern
        const multiLinePattern = new RegExp(`\\*\\*${keyword}\\s*:\\*\\*?\\s*\\n([\\s\\S]*?)(?=\\*\\*[^*]+:\\*\\*?|$)`, 'i');
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
 * Applies filtering to extracted fields based on configuration
 */
function applyFieldFilters(extractedFields, filters) {
    const { enabled, disabled, maxFields, includeOnly } = filters;
    
    let filteredFields = { ...extractedFields };
    
    // Apply enabled filter (whitelist)
    if (enabled && Array.isArray(enabled)) {
        const enabledSet = new Set(enabled);
        filteredFields = Object.fromEntries(
            Object.entries(filteredFields).filter(([key]) => enabledSet.has(key))
        );
    }
    
    // Apply disabled filter (blacklist)
    if (disabled && Array.isArray(disabled)) {
        const disabledSet = new Set(disabled);
        filteredFields = Object.fromEntries(
            Object.entries(filteredFields).filter(([key]) => !disabledSet.has(key))
        );
    }
    
    // Apply includeOnly filter (keyword matching)
    if (includeOnly && Array.isArray(includeOnly)) {
        filteredFields = Object.fromEntries(
            Object.entries(filteredFields).filter(([key, field]) => 
                includeOnly.some(keyword => 
                    field.label.toLowerCase().includes(keyword.toLowerCase()) ||
                    field.value.toLowerCase().includes(keyword.toLowerCase())
                )
            )
        );
    }
    
    // Apply maxFields filter (priority-based)
    if (maxFields && typeof maxFields === 'number') {
        const sortedEntries = Object.entries(filteredFields)
            .map(([key, field]) => ({
                key,
                field,
                priority: FIELD_CONFIG[key]?.priority || 999
            }))
            .sort((a, b) => a.priority - b.priority)
            .slice(0, maxFields);
        
        filteredFields = Object.fromEntries(
            sortedEntries.map(({ key, field }) => [key, field])
        );
    }
    
    return filteredFields;
}

/**
 * @route   POST /api/format-report
 * @desc    Formats raw incident text for TheHive with configurable field extraction and filtering.
 * @access  Public
 */
app.post('/api/format-report', (req, res) => {
    const { rawText, customFields, fieldFilters = {}, sections = {} } = req.body;

    if (!rawText || typeof rawText !== 'string') {
        return res.status(400).json({ message: 'Request body must contain a "rawText" string.' });
    }

    try {
        const cutoffRegex = /\n\s*(Graph|Additional detail)/i;
        const cutoffMatch = rawText.match(cutoffRegex);
        const textToParse = cutoffMatch ? rawText.substring(0, cutoffMatch.index) : rawText;

        let formattedString = "";
        
        const fieldConfig = customFields ? { ...FIELD_CONFIG, ...customFields } : FIELD_CONFIG;
        const sectionConfig = { ...SECTION_CONFIG, ...sections };
        
        // Extract general information fields
        let extractedFields = {};
        let hasGeneralInfo = false;
        
        for (const [fieldKey, config] of Object.entries(fieldConfig)) {
            if (config.section === 'general' && config.enabled !== false) {
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
        
        // Apply field filters
        extractedFields = applyFieldFilters(extractedFields, fieldFilters);
        hasGeneralInfo = Object.keys(extractedFields).length > 0;
        
        // Format general information section
        if (hasGeneralInfo && sectionConfig.general?.enabled !== false) {
            formattedString += `    ${sectionConfig.general?.label || 'Incident General Information'}\n`;
            
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
        if (sectionConfig.incidentInfo?.enabled !== false) {
            const incidentInfo = extractIncidentInformation(textToParse);
            if (incidentInfo) {
                formattedString += `\n    ${sectionConfig.incidentInfo?.label || 'Incident Information'}\n`;
                formattedString += `${incidentInfo}\n`;
            }
        }

        // Extract and format action & recommendation
        if (sectionConfig.actionRecommendation?.enabled !== false) {
            const actionRecommendation = extractActionRecommendation(textToParse);
            if (actionRecommendation) {
                formattedString += `\n    ${sectionConfig.actionRecommendation?.label || 'Action & Recommendation'}\n`;
                formattedString += `${actionRecommendation}\n`;
            }
        }

        res.status(200).json({ 
            formattedText: formattedString.trimEnd(),
            extractedFields: extractedFields,
            appliedFilters: fieldFilters,
            sectionsIncluded: Object.keys(sectionConfig).filter(key => sectionConfig[key]?.enabled !== false)
        });

    } catch (error) {
        console.error('Error formatting report:', error);
        res.status(500).json({ message: 'An error occurred on the server while formatting the report.' });
    }
});

/**
 * @route   POST /api/format-report/config
 * @desc    Update field and section configuration for report formatting
 * @access  Public
 */
app.post('/api/format-report/config', (req, res) => {
    const { fieldConfig, sectionConfig } = req.body;
    
    if (!fieldConfig && !sectionConfig) {
        return res.status(400).json({ message: 'Request body must contain "fieldConfig" and/or "sectionConfig" object.' });
    }
    
    try {
        if (fieldConfig && typeof fieldConfig === 'object') {
            Object.assign(FIELD_CONFIG, fieldConfig);
        }
        
        if (sectionConfig && typeof sectionConfig === 'object') {
            Object.assign(SECTION_CONFIG, sectionConfig);
        }
        
        res.status(200).json({ 
            message: 'Configuration updated successfully',
            currentFieldConfig: FIELD_CONFIG,
            currentSectionConfig: SECTION_CONFIG
        });
    } catch (error) {
        console.error('Error updating configuration:', error);
        res.status(500).json({ message: 'An error occurred while updating the configuration.' });
    }
});

/**
 * @route   GET /api/format-report/config
 * @desc    Get current field and section configuration
 * @access  Public
 */
app.get('/api/format-report/config', (req, res) => {
    res.status(200).json({
        fieldConfig: FIELD_CONFIG,
        sectionConfig: SECTION_CONFIG
    });
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
  res.send('IP Info API Backend (v4 - With Filtering) is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});