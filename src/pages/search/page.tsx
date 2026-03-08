
import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    // If there's a search query, redirect to the anime browse page with the search filter
    const query = searchParams.get('q') || searchParams.get('query');
    if (query) {
      navigate(`/anime?search=${encodeURIComponent(query)}`, { replace: true });
    } else {
      // No query - redirect to anime browse page
      navigate('/anime', { replace: true });
    }
  }, [navigate, searchParams]);

  return null;
}
