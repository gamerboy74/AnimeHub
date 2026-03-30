import axios from 'axios';

async function testScrape() {
  try {
    const res = await axios.post('http://localhost:3001/api/scrape-episode', {
      animeTitle: 'One Piece',
      animeId: 'ee3e3e8f-6d95-4757-aa39-d204c455b882',
      episodeNumber: 100
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testScrape();
