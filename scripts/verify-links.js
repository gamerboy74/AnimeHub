import axios from 'axios';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const links = [
  // No Game No Life Zero
  { anime: 'No Game No Life Zero', label: 'active (v=2)', url: 'https://flixcloud.cc/e/bc2b5y9l371n?v=2' },
  { anime: 'No Game No Life Zero', label: 'HD-2 (v=2&a=1)', url: 'https://flixcloud.cc/e/bc2b5y9l371n?v=2&a=1' },
  { anime: 'No Game No Life Zero', label: 'HD-1 (v=1)', url: 'https://flixcloud.cc/e/bc2b5y9l371n?v=1' },
  { anime: 'No Game No Life Zero', label: 'HD-1 (v=1&a=1)', url: 'https://flixcloud.cc/e/bc2b5y9l371n?v=1&a=1' },

  // Naruto Ep 1
  { anime: 'Naruto Ep 1', label: 'active (v=2)', url: 'https://flixcloud.cc/e/bo2qdw3m3kjf?v=2' },
  { anime: 'Naruto Ep 1', label: 'HD-2 (v=2&a=1)', url: 'https://flixcloud.cc/e/bo2qdw3m3kjf?v=2&a=1' },
  { anime: 'Naruto Ep 1', label: 'HD-1 (v=1)', url: 'https://flixcloud.cc/e/bo2qdw3m3kjf?v=1' },
  { anime: 'Naruto Ep 1', label: 'HD-1 (v=1&a=1)', url: 'https://flixcloud.cc/e/bo2qdw3m3kjf?v=1&a=1' },

  // Naruto Ep 2
  { anime: 'Naruto Ep 2', label: 'active (v=2)', url: 'https://flixcloud.cc/e/zj4i944olkig?v=2' },
  { anime: 'Naruto Ep 2', label: 'HD-2 (v=2&a=1)', url: 'https://flixcloud.cc/e/zj4i944olkig?v=2&a=1' },
  { anime: 'Naruto Ep 2', label: 'HD-1 (v=1)', url: 'https://flixcloud.cc/e/zj4i944olkig?v=1' },
  { anime: 'Naruto Ep 2', label: 'HD-1 (v=1&a=1)', url: 'https://flixcloud.cc/e/zj4i944olkig?v=1&a=1' },

  // Naruto Ep 3
  { anime: 'Naruto Ep 3', label: 'active (v=2)', url: 'https://flixcloud.cc/e/fr0ojt56oovi?v=2' },
  { anime: 'Naruto Ep 3', label: 'HD-2 (v=2&a=1)', url: 'https://flixcloud.cc/e/fr0ojt56oovi?v=2&a=1' },
  { anime: 'Naruto Ep 3', label: 'HD-1 (v=1)', url: 'https://flixcloud.cc/e/fr0ojt56oovi?v=1' },
  { anime: 'Naruto Ep 3', label: 'HD-1 (v=1&a=1)', url: 'https://flixcloud.cc/e/fr0ojt56oovi?v=1&a=1' },

  // Naruto Ep 4
  { anime: 'Naruto Ep 4', label: 'active (v=2)', url: 'https://flixcloud.cc/e/9zigaqfk307o?v=2' },
  { anime: 'Naruto Ep 4', label: 'HD-2 (v=2&a=1)', url: 'https://flixcloud.cc/e/9zigaqfk307o?v=2&a=1' },
  { anime: 'Naruto Ep 4', label: 'HD-1 (v=1)', url: 'https://flixcloud.cc/e/9zigaqfk307o?v=1' },
  { anime: 'Naruto Ep 4', label: 'HD-1 (v=1&a=1)', url: 'https://flixcloud.cc/e/9zigaqfk307o?v=1&a=1' },

  // Naruto Ep 5
  { anime: 'Naruto Ep 5', label: 'active (v=2)', url: 'https://flixcloud.cc/e/r9a6p6758j85?v=2' },
  { anime: 'Naruto Ep 5', label: 'HD-2 (v=2&a=1)', url: 'https://flixcloud.cc/e/r9a6p6758j85?v=2&a=1' },
  { anime: 'Naruto Ep 5', label: 'HD-1 (v=1)', url: 'https://flixcloud.cc/e/r9a6p6758j85?v=1' },
  { anime: 'Naruto Ep 5', label: 'HD-1 (v=1&a=1)', url: 'https://flixcloud.cc/e/r9a6p6758j85?v=1&a=1' }
];

async function verify() {
  console.log('🔍 Starting link verification check on Flixcloud embed player sources...\n');

  for (const item of links) {
    try {
      const response = await axios.get(item.url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Referer': 'https://reanime.to/'
        },
        timeout: 10000
      });
      console.log(`✅ [${item.anime}] - [Server ${item.label}] is ONLINE. Status: ${response.status} (Length: ${response.data.length} bytes)`);
    } catch (e) {
      console.log(`❌ [${item.anime}] - [Server ${item.label}] FAILED. Error: ${e.message}`);
    }
  }

  console.log('\n🎉 Link verification check completed.');
}

verify();
