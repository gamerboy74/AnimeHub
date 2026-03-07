
import { Link } from 'react-router-dom';



export default function Footer() {
  return (
          <footer className="bg-teal-800 text-white py-16 mt-20" aria-labelledby="footer-heading">
          <h2 id="footer-heading" className="sr-only">
            Footer
          </h2>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div>
                <h3 className="text-xl font-bold mb-4" style={{ fontFamily: '"Pacifico", serif' }}>
                  AnimeStream
                </h3>
                <p className="text-teal-200 leading-relaxed">
                  Your magical gateway to the world of anime. Discover, watch, and fall in love with stories that inspire.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Browse</h4>
                <nav aria-label="Browse links">
                  <ul className="space-y-3 text-teal-200">
                    <li>
                      <Link to="/anime?filter=popular" className="hover:text-white transition-colors duration-200">
                        Popular
                      </Link>
                    </li>
                    <li>
                      <Link to="/anime?filter=trending" className="hover:text-white transition-colors duration-200">
                        Trending
                      </Link>
                    </li>
                    <li>
                      <Link to="/anime?filter=recent" className="hover:text-white transition-colors duration-200">
                        New Releases
                      </Link>
                    </li>
                    <li>
                      <Link to="/anime?sort=rating" className="hover:text-white transition-colors duration-200">
                        Top Rated
                      </Link>
                    </li>
                  </ul>
                </nav>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Genres</h4>
                <nav aria-label="Genre links">
                  <ul className="space-y-3 text-teal-200">
                    <li>
                      <Link to="/anime?genre=action" className="hover:text-white transition-colors duration-200">
                        Action
                      </Link>
                    </li>
                    <li>
                      <Link to="/anime?genre=romance" className="hover:text-white transition-colors duration-200">
                        Romance
                      </Link>
                    </li>
                    <li>
                      <Link to="/anime?genre=fantasy" className="hover:text-white transition-colors duration-200">
                        Fantasy
                      </Link>
                    </li>
                    <li>
                      <Link to="/anime?genre=comedy" className="hover:text-white transition-colors duration-200">
                        Comedy
                      </Link>
                    </li>
                  </ul>
                </nav>
              </div>
              <div>
                <h4 className="font-semibold mb-4">Connect</h4>
                <nav className="flex space-x-4" aria-label="Social media links">
                  <a
                    href="https://twitter.com/animestream"
                    className="text-teal-200 hover:text-white transition-colors duration-200"
                    aria-label="Twitter"
                  >
                    <i className="ri-twitter-fill text-xl" aria-hidden="true" />
                  </a>
                  <a
                    href="https://facebook.com/animestream"
                    className="text-teal-200 hover:text-white transition-colors duration-200"
                    aria-label="Facebook"
                  >
                    <i className="ri-facebook-fill text-xl" aria-hidden="true" />
                  </a>
                  <a
                    href="https://instagram.com/animestream"
                    className="text-teal-200 hover:text-white transition-colors duration-200"
                    aria-label="Instagram"
                  >
                    <i className="ri-instagram-fill text-xl" aria-hidden="true" />
                  </a>
                  <a
                    href="https://discord.gg/animestream"
                    className="text-teal-200 hover:text-white transition-colors duration-200"
                    aria-label="Discord"
                  >
                    <i className="ri-discord-fill text-xl" aria-hidden="true" />
                  </a>
                </nav>
              </div>
            </div>
            <div className="border-t border-teal-700 mt-12 pt-8 text-center text-teal-200">
              <p>
                &copy; 2025 AnimeStream. All rights reserved. |{' '}
                <a href="https://readdy.ai/?origin=logo" className="hover:text-white transition-colors duration-200">
                  Powered by Readdy
                </a>
              </p>
            </div>
          </div>
        </footer>
  );
}
