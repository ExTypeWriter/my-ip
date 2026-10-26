const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`Received request for: ${req.method} ${req.url}`);
  next();
});

// ============================================================================
// UTILITY FUNCTIONS - IP OPERATIONS
// ============================================================================

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

// ============================================================================
// ROUTES - IP INFORMATION
// ============================================================================

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

// ============================================================================
// ROUTES - SUBNET OPERATIONS
// ============================================================================

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

// ============================================================================
// ROUTES
// ============================================================================

app.get('/', (req, res) => {
  res.send('IP Info API Backend (v5) is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});