import { Outlet } from 'react-router-dom';
import Navbar from '../feature/Navbar';
import Footer from '../feature/Footer';

export default function MainLayout() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-yellow-50 to-pink-50 flex flex-col">
      <Navbar />
      <main className="flex-grow">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
