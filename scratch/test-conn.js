const axios = require('axios');
axios.get('https://api.telegram.org/').then(r => console.log('Success:', r.status)).catch(e => console.error('Error:', e.message));
