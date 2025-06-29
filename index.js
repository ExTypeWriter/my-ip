const express = require('express');
const cors = require('cors');
const axios = require('axios'); 

const app = express();

const PORT = process.env.PORT || 3001;

app.use(cors());

app.use((req, res, next) => {
  console.log(`Received request for: ${req.method} ${req.url}`);
  next();
});

app.get('/api/ip-info/:ip?', async (req, res) => {
  const targetIp = req.params.ip || '';

  const fields = 'status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query';
  const apiUrl = `http://ip-api.com/json/${targetIp}?fields=${fields}`;

  try {
    console.log(`Querying ip-api for: ${targetIp || 'requesting IP'}`);
    const response = await axios.get(apiUrl);

    if (response.data.status === 'success') {
      res.status(200).json(response.data);
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

app.get('/', (req, res) => {
  res.send('IP Info API Backend is running!');
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});