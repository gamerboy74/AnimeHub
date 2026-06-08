import { describe, it, expect } from 'vitest';
import { extractSeasonNumber } from '../server/utils/seasonExtractor.js';
import { getCoreTitle } from '../server/scrapers/reanime.js';
import { isGenericTitle, isGenericDescription, mergeVideoServers } from '../server/scrapers/manager.js';

describe('Season Extractor Utility', () => {
  it('should correctly default to Season 1 for generic titles', () => {
    expect(extractSeasonNumber('One Piece')).toBe(1);
    expect(extractSeasonNumber('Naruto Shippuden')).toBe(1);
    expect(extractSeasonNumber(null as any)).toBe(1);
    expect(extractSeasonNumber('')).toBe(1);
  });

  it('should parse explicit Arabic season suffix ("Season X", "S-X")', () => {
    expect(extractSeasonNumber('Attack on Titan Season 2')).toBe(2);
    expect(extractSeasonNumber('Demon Slayer S3')).toBe(3);
    expect(extractSeasonNumber('Jujutsu Kaisen Season: 2')).toBe(2);
    expect(extractSeasonNumber('My Hero Academia s5')).toBe(5);
    expect(extractSeasonNumber('Spy x Family season-2')).toBe(2);
  });

  it('should parse forgiving spelling variants of season', () => {
    expect(extractSeasonNumber('Overlord sseason 4')).toBe(4);
    expect(extractSeasonNumber('Bleach seaon 2')).toBe(2);
    expect(extractSeasonNumber('Dr. Stone seson 3')).toBe(3);
  });

  it('should parse ordinal text representation ("2nd Season", "3rd Season")', () => {
    expect(extractSeasonNumber('Mob Psycho 100 3rd Season')).toBe(3);
    expect(extractSeasonNumber('Clannad 2nd Season')).toBe(2);
    expect(extractSeasonNumber('Rising of the Shield Hero 3rd sseason')).toBe(3);
  });

  it('should parse Roman numeral season markers at the end of titles', () => {
    expect(extractSeasonNumber('Mob Psycho 100 III')).toBe(3);
    expect(extractSeasonNumber('Overlord IV')).toBe(4);
    expect(extractSeasonNumber('Log Horizon II')).toBe(2);
    expect(extractSeasonNumber('Sword Art Online II (Dub)')).toBe(2);
  });

  it('should parse trailing Arabic numbers for sequels', () => {
    expect(extractSeasonNumber('K-On! 2')).toBe(2);
    expect(extractSeasonNumber('Darker than Black 2')).toBe(2);
  });
});

describe('Title Cleaning & Core Title Resolution', () => {
  it('should strip season noise and sub/dub markers', () => {
    expect(getCoreTitle('Attack on Titan Season 2')).toBe('attackontitan');
    expect(getCoreTitle('Mob Psycho III')).toBe('mobpsycho');
    expect(getCoreTitle('Clannad: After Story (Uncut)')).toBe('clannadafterstory');
    expect(getCoreTitle('Demon Slayer: Kimetsu no Yaiba - Entertainment District Arc [Sub]')).toBe('demonslayerkimetsunoyaibaentertainmentdistrictarc');
  });

  it('should handle complex mixed casing and special characters', () => {
    expect(getCoreTitle('Fairy Tail (2018) TV-14')).toBe('fairytail');
    expect(getCoreTitle('Steins;Gate 0')).toBe('steinsgate');
  });
});

describe('Scraper Manager Metadata Safeguards', () => {
  describe('isGenericTitle', () => {
    it('should flag generic titles as generic', () => {
      expect(isGenericTitle('Episode 12', 12, 'Chainsaw Man')).toBe(true);
      expect(isGenericTitle('Ep 5', 5, 'Death Note')).toBe(true);
      expect(isGenericTitle('death note - episode 3', 3, 'Death Note')).toBe(true);
      expect(isGenericTitle('Death Note Episode 3', 3, 'Death Note')).toBe(true);
      expect(isGenericTitle('  episode - 9  ', 9, 'Spy x Family')).toBe(true);
    });

    it('should NOT flag custom/curated episode titles as generic', () => {
      expect(isGenericTitle('To You, in 2000 Years', 1, 'Attack on Titan')).toBe(false);
      expect(isGenericTitle('The Day the Demon Was Born', 1, 'Code Geass')).toBe(false);
    });
  });

  describe('isGenericDescription', () => {
    it('should flag generic/scraped descriptions as generic', () => {
      expect(isGenericDescription('episode 12 of chainsaw man', 12, 'Chainsaw Man')).toBe(true);
      expect(isGenericDescription('Scraped from 9anime.to', 1, 'One Piece')).toBe(true);
      expect(isGenericDescription('Episode 5', 5, 'Naruto')).toBe(true);
    });

    it('should NOT flag rich, curated descriptions', () => {
      expect(isGenericDescription('Luffy sets out to sea to find the legendary One Piece and become the Pirate King.', 1, 'One Piece')).toBe(false);
    });
  });
});

describe('Scraper Server Merging & Deduplication', () => {
  it('should merge and deduplicate servers by URL, prioritizing lang categories', () => {
    const existing = [
      { name: 'SUB 1', url: 'https://server1.com/embed/123', lang: 'sub' },
      { name: 'DUB 1', url: 'https://server2.com/embed/456', lang: 'dub' }
    ];

    const newlyFound = [
      { name: 'New Sub Server', url: 'https://server3.com/embed/789', lang: 'sub' },
      { name: 'Duplicate Sub Server', url: 'https://server1.com/embed/123', lang: 'sub' }, // Duplicate
      { name: 'New Dub Server', url: 'https://server4.com/embed/000', lang: 'dub' }
    ];

    const merged = mergeVideoServers(existing, newlyFound);

    // Should have 4 unique servers in total (2 sub, 2 dub)
    expect(merged.length).toBe(4);
    expect(merged.filter(s => s.lang === 'sub').length).toBe(2);
    expect(merged.filter(s => s.lang === 'dub').length).toBe(2);

    // Verify ordering and naming conventions
    expect(merged[0].name).toBe('SUB 1');
    expect(merged[1].name).toBe('SUB 2');
    expect(merged[2].name).toBe('DUB 1');
    expect(merged[3].name).toBe('DUB 2');
    expect(merged.map(s => s.url)).toEqual([
      'https://server1.com/embed/123',
      'https://server3.com/embed/789',
      'https://server2.com/embed/456',
      'https://server4.com/embed/000'
    ]);
  });
});
