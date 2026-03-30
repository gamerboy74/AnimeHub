import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import LoginModal from '../../components/auth/LoginModal';
import SignUpModal from '../../components/auth/SignUpModal';
import { useCurrentUser } from '../../hooks/auth/selectors';

export default function LoginPage() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [searchParams] = useSearchParams();
  const [showLogin, setShowLogin] = useState(!searchParams.get('signup'));
  const [showSignUp, setShowSignUp] = useState(!!searchParams.get('signup'));

  let redirectTo = searchParams.get('redirect') || '/';
  // Prevent redirect loops
  if (redirectTo.startsWith('/login')) {
    redirectTo = '/';
  }

  // If user is already logged in, redirect
  useEffect(() => {
    if (user) {
      navigate(redirectTo, { replace: true });
    }
  }, [user, navigate, redirectTo]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50 flex items-center justify-center">
      <LoginModal
        isOpen={showLogin}
        onClose={() => {
          setShowLogin(false);
          navigate(redirectTo, { replace: true });
        }}
        onSwitchToSignUp={() => {
          setShowLogin(false);
          setShowSignUp(true);
        }}
      />
      <SignUpModal
        isOpen={showSignUp}
        onClose={() => {
          setShowSignUp(false);
          navigate(redirectTo, { replace: true });
        }}
        onSwitchToLogin={() => {
          setShowSignUp(false);
          setShowLogin(true);
        }}
      />
    </div>
  );
}
