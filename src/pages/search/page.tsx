
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function SearchPage() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to home since search is now in navbar
    navigate('/', { replace: true });
  }, [navigate]);

  return null;
}
