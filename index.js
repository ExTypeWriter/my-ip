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

/**
 * @route   POST /api/format-report
 * @desc    Formats raw incident text for TheHive.
 * @access  Public
 */
app.post('/api/format-report', (req, res) => {
    const { rawText } = req.body;

    if (!rawText || typeof rawText !== 'string') {
        return res.status(400).json({ message: 'Request body must contain a "rawText" string.' });
    }

    try {
        const cutoffRegex = /\n\s*(Graph|Additional detail)/i;
        const cutoffMatch = rawText.match(cutoffRegex);
        const textToParse = cutoffMatch ? rawText.substring(0, cutoffMatch.index) : rawText;

        const extractSection = (regex) => {
            const lineMatch = textToParse.match(regex);
            if (!lineMatch || !lineMatch[1]) return null;

            const genericPattern = /(.*?)(?:\s+[A-Za-z ]+\s*:|$)/;
            const valueMatch = lineMatch[1].match(genericPattern);
            
            return valueMatch && valueMatch[1] ? valueMatch[1].trim() : null;
        };
        
        const categoryValue = extractSection(/^.*Category\s*:(.*)$/m);
        const subCategoriesValue = extractSection(/^.*Sub Categor(?:y|ies)\s*:(.*)$/m);
        const deviceActionValue = extractSection(/^.*Device Action\s*:(.*)$/m);

        let formattedString = "";

        if (categoryValue || subCategoriesValue || deviceActionValue) {
            formattedString += "    Incident General Information\n";
            if (categoryValue) formattedString += `Category : ${categoryValue}\n`;
            if (subCategoriesValue) formattedString += `Sub Categories : ${subCategoriesValue}\n`;
            if (deviceActionValue) formattedString += `Device Action : ${deviceActionValue}\n`;
        }

        const incidentInfoMatch = textToParse.match(/Incident Information\s*([\s\S]*?)\s*(?:Event Time|Action & Recommendation|$)/);
        if (incidentInfoMatch && incidentInfoMatch[1].trim()) {
            const descriptionContent = incidentInfoMatch[1].replace(/Incident Detail:/, "").trim();
            if (descriptionContent) {
                formattedString += "\n    Incident Information\n";
                formattedString += `${descriptionContent}\n`;
            }
        }

        const actionRecommendationMatch = textToParse.match(/Action & Recommendation\s*([\s\S]*)/);
        if (actionRecommendationMatch && actionRecommendationMatch[1].trim()) {
            formattedString += "\n    Action & Recommendation\n";
            const recommendations = actionRecommendationMatch[1].trim().replace(/\n\s*\n/g, "\n");
            formattedString += `${recommendations}\n`;
        }

        res.status(200).json({ formattedText: formattedString.trimEnd() });

    } catch (error) {
        console.error('Error formatting report:', error);
        res.status(500).json({ message: 'An error occurred on the server while formatting the report.' });
    }
});


app.get('/', (req, res) => {
  res.send('IP Info API Backend (v2 - Patched) is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
