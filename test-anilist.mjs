import axios from 'axios';

async function test() {
  const query = `
    query ($search: String) {
      Media (search: $search, type: ANIME) {
        bannerImage
      }
    }
  `;
  try {
    const res = await axios.post('https://graphql.anilist.co', {
      query,
      variables: { search: 'Naruto' }
    });
    console.log("Banner:", res.data.data.Media.bannerImage);
  } catch (error) {
    console.error(error.message);
  }
}
test();
