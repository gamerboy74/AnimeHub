/**
 * Test script for gogoanime URL extraction
 * Usage: node scripts/test-gogoanime-extract.js <gogoanime-url>
 */

import axios from 'axios';

const gogoanimeUrl = process.argv[2];

if (!gogoanimeUrl) {
  console.log('❌ Please provide a gogoanime URL');
  console.log('Usage: node scripts/test-gogoanime-extract.js <gogoanime-url>');
  console.log('Example: node scripts/test-gogoanime-extract.js "https://gogoanime.me.uk/episode/one-piece-episode-1"');
  process.exit(1);
}

async function testExtraction() {
  try {
    console.log('🔍 Testing gogoanime URL extraction...');
    console.log('📍 URL:', gogoanimeUrl);
    console.log('');

    // Call the API endpoint
    const response = await axios.post('http://localhost:3001/api/test-gogoanime-extract', {
      gogoanimeUrl: gogoanimeUrl
    });

    const data = response.data;

    if (data.success) {
      console.log('✅ Extraction successful!');
      console.log('');
      console.log('📊 Results:');
      console.log('   HTML Length:', data.htmlLength);
      console.log('   Megaplay URLs found:', data.results.megaplayUrls.length);
      console.log('   Total iframes found:', data.results.allIframeUrls.length);
      console.log('   Other video URLs:', data.results.otherVideoUrls.length);
      console.log('');

      if (data.results.megaplayUrls.length > 0) {
        console.log('🎯 MEGAPLAY URLs:');
        data.results.megaplayUrls.forEach((url, i) => {
          console.log(`   ${i + 1}. ${url}`);
        });
        console.log('');
      }

      if (data.results.allIframeUrls.length > 0) {
        console.log('📺 All Iframe URLs:');
        data.results.allIframeUrls.forEach((url, i) => {
          console.log(`   ${i + 1}. ${url}`);
        });
        console.log('');
      }

      if (data.recommended) {
        console.log('💡 RECOMMENDED VIDEO URL:');
        console.log('   ', data.recommended);
      }

    } else {
      console.log('❌ Extraction failed:', data.error);
      if (data.details) {
        console.log('   Details:', data.details);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
  }
}

// Run the test
testExtraction();
