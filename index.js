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



/**
 * @route   GET /api/ip-info/:ip?
 * @desc    Get geolocation info for a specific IP or the requesting IP.
 * Accepts a 'fields' query parameter.
 * @access  Public
 * @example /api/ip-info/8.8.8.8?fields=country,city,isp
 */
app.get('/api/ip-info/:ip?', async (req, res) => {
  const targetIp = req.params.ip || '';
  const fields = req.query.fields || 'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query';
  const apiUrl = `http://ip-api.com/json/${targetIp}?fields=${fields}`;

  try {
    console.log(`Querying single IP: ${targetIp || 'requesting IP'} with fields: ${fields}`);
    const response = await axios.get(apiUrl);

    if (response.data.status === 'success') {
      res.status(200).json([response.data]);
    } else {
      console.error('ip-api returned an error:', response.data.message);
      res.status(400).json({
        message: 'Failed to retrieve IP information.',
        error: response.data.message
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
 * @body    { "ips": ["1.1.1.1", "8.8.8.8"], "fields": "country,city,query" }
 */
app.post('/api/ip-info/batch', async (req, res) => {
  const { ips, fields } = req.body;

  if (!ips || !Array.isArray(ips) || ips.length === 0) {
    return res.status(400).json({ message: 'Request body must contain an array of IPs.' });
  }
  
  const apiUrl = `http://ip-api.com/batch?fields=${fields || 'status,message,query,country,city'}`;

  try {
    console.log(`Querying batch IPs with fields: ${fields}`);
    const response = await axios.post(apiUrl, ips);
    
    res.status(200).json(response.data);

  } catch (error) {
    console.error('Error fetching batch data from ip-api:', error.message);
    res.status(500).json({ message: 'An error occurred on the server.' });
  }
});


app.get('/', (req, res) => {
  res.send('IP Info API Backend (v2) is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
