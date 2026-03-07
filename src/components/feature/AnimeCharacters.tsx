import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/database/supabase';
import { useInView } from 'react-intersection-observer';
import React, { Suspense } from 'react';

interface Character {
  id: string;
  name: string;
  name_japanese?: string;
  name_romaji?: string;
  role: string;
  image_url?: string;
  description?: string;
}

type ParsedCharacterDetails = {
  height?: string;
  weight?: string;
  age?: string;
  birthday?: string;
  gender?: string;
  bloodType?: string;
  affiliation?: string;
  occupation?: string;
  father?: string;
  mother?: string;
  siblings?: string;
  spouse?: string;
  partner?: string;
  alias?: string;
  species?: string;
  origin?: string;
  relatives?: string[];
  voiceActorsEnglish?: string;
  voiceActorsJapanese?: string;
  firstAppearanceManga?: string;
  firstAppearanceAnime?: string;
}

const detailLabels: Record<keyof ParsedCharacterDetails, string> = {
  height: 'Height',
  weight: 'Weight',
  age: 'Age',
  birthday: 'Birthday',
  gender: 'Gender',
  bloodType: 'Blood type',
  affiliation: 'Affiliation',
  occupation: 'Occupation',
  father: 'Father',
  mother: 'Mother',
  siblings: 'Siblings',
  spouse: 'Spouse',
  partner: 'Partner',
  alias: 'Alias',
  species: 'Species',
  origin: 'Origin',
  relatives: 'Relatives',
  voiceActorsEnglish: 'English Voice Actor',
  voiceActorsJapanese: 'Japanese Voice Actor',
  firstAppearanceManga: 'First Manga Appearance',
  firstAppearanceAnime: 'First Anime Appearance',
};

const detailIcons: Record<keyof ParsedCharacterDetails, string> = {
  height: 'ri-ruler-line',
  weight: 'ri-scales-line',
  age: 'ri-cake-2-line',
  birthday: 'ri-calendar-event-line',
  gender: 'ri-genderless-line',
  bloodType: 'ri-drop-line',
  affiliation: 'ri-building-line',
  occupation: 'ri-briefcase-line',
  father: 'ri-parent-line',
  mother: 'ri-parent-line',
  siblings: 'ri-group-line',
  spouse: 'ri-heart-line',
  partner: 'ri-hand-heart-line',
  alias: 'ri-user-star-line',
  species: 'ri-leaf-line',
  origin: 'ri-earth-line',
  relatives: 'ri-team-line',
  voiceActorsEnglish: 'ri-mic-line',
  voiceActorsJapanese: 'ri-mic-line',
  firstAppearanceManga: 'ri-book-open-line',
  firstAppearanceAnime: 'ri-film-line',
};

function cleanValue(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/^[,\.\s\-—_]+|[,\.\s\-—_]+$/g, '')
    .replace(/\s*\[[^\]]*\]\s*$/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function getCleanDescription(rawText?: string): string {
  if (!rawText) return '';

  let text = rawText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const bioStartRe = /\s([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(is|was|a|the)\b/i;
  const bioMatch = text.match(bioStartRe);
  if (bioMatch) {
    return text.substring(bioMatch.index!).trim();
  }

  return text;
}

function extractCharacterDetails(rawText?: string): ParsedCharacterDetails {
  if (!rawText) return {};

  let text = rawText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const out: ParsedCharacterDetails = {};

  const infoboxRe = /__([A-Za-z\s\-]+):__\s*(.+?)(?=__|$)/gs;
  const infoboxMatches: Array<{ label: string; value: string }> = [];
  let infoboxMatch;
  while ((infoboxMatch = infoboxRe.exec(text)) !== null) {
    const rawLabel = infoboxMatch[1].trim();
    let rawValue = infoboxMatch[2].trim();
    const bioStartRe = /\s([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(is|was|a|the)\b/i;
    const bioTrim = rawValue.match(bioStartRe);
    if (bioTrim) {
      rawValue = rawValue.substring(0, bioTrim.index!).trim();
    }
    infoboxMatches.push({
      label: rawLabel.toLowerCase().replace(/\s+/g, ' '),
      value: rawValue,
    });
  }

  for (const { label, value: rawValue } of infoboxMatches) {
    let value = cleanValue(rawValue);
    if (!value) continue;

    if (label.includes('relatives') || label.includes('family') || label.includes('parents')) {
      const relNames = rawValue
        .split(/,\s*(?=[A-Z])|and\s+/)
        .map((name) => cleanValue(name.replace(/\(.*?\)/g, '')))
        .filter(Boolean);
      out.relatives = relNames;
      if (!out.father && /father|dad/i.test(rawValue)) {
        const fatherMatch = rawValue.match(/([A-Za-z\s\-]+?)(?:\s*\([^)]*father[^)]*\))/i);
        if (fatherMatch?.[1]) out.father = cleanValue(fatherMatch[1]);
      }
      if (!out.mother && /mother|mom/i.test(rawValue)) {
        const motherMatch = rawValue.match(/([A-Za-z\s\-]+?)(?:\s*\([^)]*mother[^)]*\))/i);
        if (motherMatch?.[1]) out.mother = cleanValue(motherMatch[1]);
      }
      continue;
    }

    if (label.includes('voice') || label.includes('va')) {
      if (label.includes('english')) out.voiceActorsEnglish = value;
      else if (label.includes('japanese')) out.voiceActorsJapanese = value;
      continue;
    }

    if (label.includes('first appearance') || label.includes('debut')) {
      if (label.includes('manga')) out.firstAppearanceManga = value;
      else if (label.includes('anime')) out.firstAppearanceAnime = value;
      continue;
    }

    let field: keyof ParsedCharacterDetails | null = null;
    if (label.includes('height')) field = 'height';
    else if (label.includes('weight')) field = 'weight';
    else if (label.includes('age')) field = 'age';
    else if (label.includes('birthday') || label.includes('birth date') || label.includes('born')) field = 'birthday';
    else if (label.includes('gender') || label.includes('sex')) field = 'gender';
    else if (label.includes('blood type') || label.includes('blood')) field = 'bloodType';
    else if (label.includes('affiliation') || label.includes('organization') || label.includes('team')) field = 'affiliation';
    else if (label.includes('occupation') || label.includes('job') || label.includes('role')) field = 'occupation';
    else if (label.includes('father') || label.includes('dad')) field = 'father';
    else if (label.includes('mother') || label.includes('mom')) field = 'mother';
    else if (label.includes('sibling') || label.includes('brother') || label.includes('sister') || label.includes('siblings')) field = 'siblings';
    else if (label.includes('spouse') || label.includes('wife') || label.includes('husband')) field = 'spouse';
    else if (label.includes('partner')) field = 'partner';
    else if (label.includes('alias') || label.includes('aka') || label.includes('also known as') || label.includes('nicknames') || label.includes('nickname')) field = 'alias';
    else if (label.includes('species') || label.includes('race')) field = 'species';
    else if (label.includes('origin') || label.includes('hometown') || label.includes('home town') || label.includes('from')) field = 'origin';

    if (field) {
      out[field] = value;
    }
  }

  if (infoboxMatches.length === 0) {
    type Pattern = { keys: string[]; assign: (val: string) => void };
    const patterns: Pattern[] = [
      { keys: ['height'], assign: (v) => (out.height = v) },
      { keys: ['weight'], assign: (v) => (out.weight = v) },
      { keys: ['age'], assign: (v) => (out.age = v) },
      { keys: ['birthday', 'birth date', 'born'], assign: (v) => (out.birthday = v) },
      { keys: ['gender', 'sex'], assign: (v) => (out.gender = v) },
      { keys: ['blood type', 'blood'], assign: (v) => (out.bloodType = v) },
      { keys: ['affiliation', 'organization', 'team'], assign: (v) => (out.affiliation = v) },
      { keys: ['occupation', 'job', 'role'], assign: (v) => (out.occupation = v) },
      { keys: ['father', 'dad'], assign: (v) => (out.father = v) },
      { keys: ['mother', 'mom'], assign: (v) => (out.mother = v) },
      { keys: ['sibling', 'brother', 'sister', 'siblings'], assign: (v) => (out.siblings = v) },
      { keys: ['spouse', 'wife', 'husband'], assign: (v) => (out.spouse = v) },
      { keys: ['partner'], assign: (v) => (out.partner = v) },
      { keys: ['alias', 'aka', 'also known as', 'nicknames', 'nickname'], assign: (v) => (out.alias = v) },
      { keys: ['species', 'race'], assign: (v) => (out.species = v) },
      { keys: ['origin', 'hometown', 'home town', 'from'], assign: (v) => (out.origin = v) },
      { keys: ['voice actor english', 'va english'], assign: (v) => (out.voiceActorsEnglish = v) },
      { keys: ['voice actor japanese', 'va japanese'], assign: (v) => (out.voiceActorsJapanese = v) },
      { keys: ['first appearance manga', 'debut manga'], assign: (v) => (out.firstAppearanceManga = v) },
      { keys: ['first appearance anime', 'debut anime'], assign: (v) => (out.firstAppearanceAnime = v) },
    ];

    for (const { keys, assign } of patterns) {
      const keyGroup = keys
        .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      const re = new RegExp(
        `(?:^|[.?!;\\n\\r\\t\\s])(?:${keyGroup})\\s*[:\\-—]\\s*(.+?)(?=\\.\\s*[A-Z]|[.?!)\\n]|$)`,
        'i'
      );
      const m = text.match(re);
      if (m && m[1]) {
        const value = cleanValue(m[1].trim());
        if (value) assign(value);
      }
    }

    const relMatch = text.match(/(?:relatives|family|parents)\\s*[:\\-—]\\s*(.+?)(?=\\.\\s*[A-Z]|[.?!)\\n]|$)/i);
    if (relMatch?.[1]) {
      const relNames = relMatch[1]
        .split(/,\s*(?=[A-Z])|and\s+/)
        .map((name) => cleanValue(name.replace(/\(.*?\)/g, '')))
        .filter(Boolean);
      out.relatives = relNames;
    }
  }

  return out;
}

type DetailSection = {
  title: string;
  icon: string;
  details: Array<{ key: keyof ParsedCharacterDetails; value: any; label: string }>;
};

function groupDetailsIntoSections(details: ParsedCharacterDetails): DetailSection[] {
  const physical: Array<{ key: keyof ParsedCharacterDetails; value: any; label: string }> = [];
  const personal: Array<{ key: keyof ParsedCharacterDetails; value: any; label: string }> = [];
  const family: Array<{ key: keyof ParsedCharacterDetails; value: any; label: string }> = [];
  const media: Array<{ key: keyof ParsedCharacterDetails; value: any; label: string }> = [];
  const other: Array<{ key: keyof ParsedCharacterDetails; value: any; label: string }> = [];

  const entries = Object.entries(details) as Array<[keyof ParsedCharacterDetails, any]>;
  entries.forEach(([key, value]) => {
    if (!value) return;
    const entry = { key, value, label: detailLabels[key] };
    if (['height', 'weight', 'age', 'birthday', 'gender', 'bloodType', 'species'].includes(key)) {
      physical.push(entry);
    } else if (['father', 'mother', 'siblings', 'spouse', 'partner', 'relatives'].includes(key)) {
      family.push(entry);
    } else if (['voiceActorsEnglish', 'voiceActorsJapanese', 'firstAppearanceManga', 'firstAppearanceAnime'].includes(key)) {
      media.push(entry);
    } else if (['affiliation', 'occupation', 'origin', 'alias'].includes(key)) {
      other.push(entry);
    } else {
      personal.push(entry);
    }
  });

  const sortDetails = (a: { key: string; value: any; label: string }, b: { key: string; value: any; label: string }) =>
    a.label.localeCompare(b.label);

  const sections: DetailSection[] = [];
  if (physical.length > 0) {
    sections.push({ title: 'Physical Attributes', icon: 'ri-ruler-line', details: physical.sort(sortDetails) });
  }
  if (personal.length > 0) {
    sections.push({ title: 'Personal Info', icon: 'ri-user-line', details: personal.sort(sortDetails) });
  }
  if (family.length > 0) {
    sections.push({ title: 'Family & Relatives', icon: 'ri-team-line', details: family.sort(sortDetails) });
  }
  if (media.length > 0) {
    sections.push({ title: 'Media & Debut', icon: 'ri-mic-line', details: media.sort(sortDetails) });
  }
  if (other.length > 0) {
    sections.push({ title: 'Other', icon: '📋', details: other.sort(sortDetails) });
  }

  return sections;
}

interface CharacterCardProps {
  character: Character;
  index: number;
  onOpen: (character: Character) => void;
}

const CharacterCard = React.memo(({ character, index, onOpen }: CharacterCardProps) => {
  const { ref, inView } = useInView({ triggerOnce: true });

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'main':
        return 'bg-gradient-to-r from-yellow-400 via-orange-400 to-red-500 text-white shadow-lg';
      case 'supporting':
        return 'bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-500 text-white shadow-lg';
      case 'antagonist':
        return 'bg-gradient-to-r from-red-400 via-pink-400 to-purple-500 text-white shadow-lg';
      case 'background':
        return 'bg-gradient-to-r from-gray-400 via-gray-500 to-gray-600 text-white shadow-lg';
      default:
        return 'bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-500 text-white shadow-lg';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'main':
        return '⭐';
      case 'supporting':
        return '👥';
      case 'antagonist':
        return '😈';
      case 'background':
        return '👤';
      default:
        return '🎭';
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen(character);
      }
    },
    [character, onOpen]
  );

  const handleClick = useCallback(() => {
    onOpen(character);
  }, [character, onOpen]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30, rotate: -5 }}
      animate={inView ? { opacity: 1, y: 0, rotate: 0 } : {}}
      whileHover={{ y: -10, rotate: 1, transition: { duration: 0.2 } }}
      transition={{ duration: 0.4, delay: index * 0.1, type: 'spring' }}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      className="bg-white/70 backdrop-blur-sm rounded-2xl p-6 shadow-xl border border-white/30 hover:shadow-2xl hover:border-teal-200/50 transition-all duration-500 group cursor-pointer relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.8) 0%, rgba(34,197,94,0.1) 100%)',
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 to-cyan-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

      <div className="relative mb-4 z-10">
        <motion.div
          whileHover={{ scale: 1.1 }}
          className="w-24 h-24 mx-auto rounded-2xl overflow-hidden bg-gradient-to-br from-teal-200 via-cyan-200 to-blue-200 shadow-lg border-2 border-white/50"
        >
          {character.image_url ? (
            <motion.img
              src={character.image_url}
              alt={character.name}
              width={96} // Match w-24
              height={96} // Match h-24
              loading="lazy"
              className="w-full h-full object-cover"
              whileHover={{ scale: 1.1 }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl bg-gradient-to-br from-teal-300 to-cyan-300">
              🎭
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ scale: 0, rotate: 180 }}
          animate={inView ? { scale: 1, rotate: 0 } : {}}
          className={`absolute -top-3 -right-3 px-3 py-1.5 rounded-full text-xs font-bold ${getRoleColor(character.role)} shadow-md`}
        >
          <span className="mr-1">{getRoleIcon(character.role)}</span>
          <span>{character.role}</span>
        </motion.div>
      </div>

      <div className="text-center relative z-10">
        <motion.h3
          initial={{ y: 10, opacity: 0 }}
          animate={inView ? { y: 0, opacity: 1 } : {}}
          whileHover={{ color: '#0f766e' }}
          className="font-bold text-gray-800 text-lg mb-1"
        >
          {character.name}
        </motion.h3>

        {character.name_japanese && character.name_japanese !== character.name && (
          <motion.p
            initial={{ y: 10, opacity: 0 }}
            animate={inView ? { y: 0, opacity: 1 } : {}}
            className="text-gray-600 text-sm mb-2"
          >
            {character.name_japanese}
          </motion.p>
        )}

        {character.name_romaji && !character.name_romaji.startsWith('[') && (
          <motion.p
            initial={{ y: 10, opacity: 0 }}
            animate={inView ? { y: 0, opacity: 1 } : {}}
            className="text-gray-500 text-xs mb-3 italic"
          >
            Romaji: {character.name_romaji}
          </motion.p>
        )}

        {character.description && (
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={inView ? { y: 0, opacity: 1 } : {}}
            className="mt-3 text-xs text-gray-600 line-clamp-2 leading-relaxed"
          >
            {getCleanDescription(character.description)}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
});

CharacterCard.displayName = 'CharacterCard';

interface CharacterDetailsProps {
  character: Character;
  onClose: () => void;
}

const CharacterDetails = React.memo(({ character, onClose }: CharacterDetailsProps) => {
  const getRoleColor = (role: string) => {
    switch (role) {
      case 'main':
        return 'bg-gradient-to-r from-yellow-400 via-orange-400 to-red-500 text-white shadow-lg';
      case 'supporting':
        return 'bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-500 text-white shadow-lg';
      case 'antagonist':
        return 'bg-gradient-to-r from-red-400 via-pink-400 to-purple-500 text-white shadow-lg';
      case 'background':
        return 'bg-gradient-to-r from-gray-400 via-gray-500 to-gray-600 text-white shadow-lg';
      default:
        return 'bg-gradient-to-r from-teal-400 via-cyan-400 to-blue-500 text-white shadow-lg';
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'main':
        return '⭐';
      case 'supporting':
        return '👥';
      case 'antagonist':
        return '😈';
      case 'background':
        return '👤';
      default:
        return '🎭';
    }
  };

  const parsedDetails = useMemo(() => {
    if (!character.description) return {};
    return extractCharacterDetails(character.description);
  }, [character.description]);

  const sections = useMemo(() => groupDetailsIntoSections(parsedDetails), [parsedDetails]);
  const cleanDesc = useMemo(() => getCleanDescription(character.description), [character.description]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
      className="bg-gradient-to-b from-white/95 via-white/90 to-teal-50/80 backdrop-blur-md border-l border-white/20 overflow-hidden w-full max-w-md flex flex-col"
    >
      <div className="p-6 flex-1 overflow-y-auto">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center justify-between mb-6"
        >
          <div className="flex items-center">
            <motion.button
              whileHover={{ scale: 0.95 }}
              whileTap={{ scale: 0.9 }}
              onClick={handleClose}
              className="mr-3 p-2 rounded-2xl hover:bg-gray-100/50 transition-all duration-200 backdrop-blur-sm"
              aria-label="Close"
            >
              <i className="ri-arrow-left-line text-gray-600 text-xl"></i>
            </motion.button>
            <motion.h2
              initial={{ x: -20 }}
              animate={{ x: 0 }}
              className="text-2xl font-bold text-gray-800 bg-gradient-to-r from-teal-800 to-cyan-600 bg-clip-text text-transparent"
            >
              {character.name}
            </motion.h2>
          </div>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={`px-3 py-1.5 rounded-full text-xs font-bold ${getRoleColor(character.role)}`}
          >
            <span className="mr-1">{getRoleIcon(character.role)}</span>
            <span>{character.role}</span>
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center mb-6"
        >
          <motion.div
            whileHover={{ scale: 1.05, rotate: 2 }}
            className="w-40 h-40 mx-auto rounded-3xl overflow-hidden bg-gradient-to-br from-teal-200 via-cyan-200 to-blue-200 shadow-2xl border-4 border-white/30"
          >
            {character.image_url ? (
              <motion.img
                src={character.image_url}
                alt={character.name}
                width={160} // Match w-40
                height={160} // Match h-40
                loading="eager" // Load immediately for details panel
                className="w-full h-full object-cover"
                whileHover={{ scale: 1.1 }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-teal-300 to-cyan-300">
                🎭
              </div>
            )}
          </motion.div>
        </motion.div>

        {(character.name_japanese || character.name_romaji) && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="mb-6"
          >
            <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center bg-gradient-to-r from-teal-800 to-cyan-600 bg-clip-text text-transparent">
              <i className="ri-user-3-line mr-2 text-teal-500"></i>
              Names
            </h3>
            <div className="space-y-3">
              {character.name_japanese && character.name_japanese !== character.name && (
                <motion.div
                  whileHover={{ x: 5 }}
                  className="flex items-center gap-3 p-4 bg-gradient-to-r from-teal-50 to-cyan-50 rounded-2xl shadow-md border border-teal-100/50"
                >
                  <span className="text-teal-500 text-xl">🇯🇵</span>
                  <span className="text-gray-700 text-sm font-medium">
                    Japanese: <span className="font-black">{character.name_japanese}</span>
                  </span>
                </motion.div>
              )}
              {character.name_romaji && (
                character.name_romaji.startsWith('[') ? (
                  <motion.div
                    whileHover={{ x: 5 }}
                    className="p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-2xl shadow-md border border-purple-100/50"
                  >
                    <span className="text-gray-700 text-sm font-medium block mb-2 bg-gradient-to-r from-purple-800 to-pink-600 bg-clip-text text-transparent">
                      Aliases:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        try {
                          const aliases = JSON.parse(character.name_romaji);
                          return aliases.map((alias: string, idx: number) => (
                            <motion.span
                              key={idx}
                              whileHover={{ scale: 1.05 }}
                              className="px-3 py-1.5 bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 text-xs rounded-full shadow-sm font-medium"
                            >
                              {alias}
                            </motion.span>
                          ));
                        } catch {
                          const aliases = character.name_romaji
                            .slice(1, -1)
                            .split('","')
                            .map((s) => s.replace(/^"/, '').replace(/"$/, ''));
                          return aliases.map((alias: string, idx: number) => (
                            <motion.span
                              key={idx}
                              whileHover={{ scale: 1.05 }}
                              className="px-3 py-1.5 bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 text-xs rounded-full shadow-sm font-medium"
                            >
                              {alias}
                            </motion.span>
                          ));
                        }
                      })()}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    whileHover={{ x: 5 }}
                    className="flex items-center gap-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl shadow-md border border-blue-100/50"
                  >
                    <span className="text-blue-500 text-xl">🔤</span>
                    <span className="text-gray-700 text-sm font-medium">
                      Romaji: <span className="font-black">{character.name_romaji}</span>
                    </span>
                  </motion.div>
                )
              )}
            </div>
          </motion.div>
        )}

        {sections.length > 0 && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-6"
          >
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center bg-gradient-to-r from-teal-800 to-cyan-600 bg-clip-text text-transparent">
              <i className="ri-information-line mr-2 text-teal-500"></i>
              Profile Details
            </h3>
            <div className="space-y-4">
              {sections.map((section, index) => (
                <motion.div
                  key={section.title}
                  initial={{ y: 20, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                >
                  <h4 className="text-md font-medium text-teal-700 mb-3 flex items-center">
                    <i className={`${section.icon} mr-2 text-xl text-teal-500`}></i>
                    <span className="bg-gradient-to-r from-teal-800 to-teal-600 bg-clip-text text-transparent font-bold">
                      {section.title}
                    </span>
                  </h4>
                  <div className="space-y-3">
                    {section.details.map(({ key, value, label }) => (
                      <motion.div
                        whileHover={{ x: 5 }}
                        key={key as string}
                        className="flex items-start gap-4 p-4 bg-gradient-to-r from-white/70 to-teal-50/50 rounded-2xl shadow-lg border border-teal-100/30 backdrop-blur-sm"
                      >
                        <i className={`${detailIcons[key]} text-xl text-teal-500 mt-1`}></i>
                        <div className="flex-1">
                          <span className="block text-xs font-semibold text-teal-500 uppercase tracking-wide">{label}</span>
                          {Array.isArray(value) ? (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {value.map((item, idx) => (
                                <span key={idx} className="px-2 py-1 bg-teal-100 text-teal-700 text-xs rounded-full">
                                  {item}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-sm text-gray-700 font-medium block mt-1">{value}</span>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {character.description && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4 }}
          >
            <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center bg-gradient-to-r from-teal-800 to-cyan-600 bg-clip-text text-transparent">
              <i className="ri-chat-3-line mr-2 text-teal-500"></i>
              Description
            </h3>
            <div className="text-sm text-gray-600 leading-relaxed prose prose-sm max-w-none bg-gradient-to-br from-white/70 to-teal-50/50 p-5 rounded-2xl shadow-xl border border-teal-100/30 backdrop-blur-sm">
              <p>{cleanDesc}</p>
            </div>
          </motion.div>
        )}
      </div>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="p-6 border-t border-white/20 bg-white/50"
      >
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={handleClose}
          className="w-full py-3 px-6 bg-gradient-to-r from-teal-500 to-cyan-500 text-white rounded-2xl hover:from-teal-600 hover:to-cyan-600 transition-all duration-200 font-semibold shadow-lg"
        >
          <i className="ri-close-circle-line mr-2"></i>
          Close
        </motion.button>
      </motion.div>
    </motion.div>
  );
});

CharacterDetails.displayName = 'CharacterDetails';

interface AnimeCharactersProps {
  animeId: string;
}

export default function AnimeCharacters({ animeId }: AnimeCharactersProps) {
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);

  const { data: characters = [], isLoading: loading, error, refetch } = useQuery({
    queryKey: ['animeCharacters', animeId],
    queryFn: async () => {
      const { data, error: fetchError } = await supabase
        .from('anime_characters')
        .select('id, name, name_japanese, name_romaji, role, image_url, description')
        .eq('anime_id', animeId)
        .order('role', { ascending: true });

      if (fetchError) {
        console.error('Error fetching characters:', fetchError);
        throw new Error('Failed to load characters');
      }

      return data || [];
    },
    enabled: !!animeId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
  });

  const filteredCharacters = useMemo(() => characters.filter((char) => char.role === 'main'), [characters]);

  const openCharacter = useCallback((character: Character) => {
    setSelectedCharacter(character);
  }, []);

  const closeCharacter = useCallback(() => {
    setSelectedCharacter(null);
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedCharacter) {
        closeCharacter();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [selectedCharacter, closeCharacter]);

  const getFilteredCharacters = useCallback(() => {
    return filteredCharacters;
  }, [filteredCharacters]);

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-2xl border border-white/20"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="bg-gray-200 animate-pulse rounded-2xl h-64"></div>
          ))}
        </div>
      </motion.div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-2xl border border-white/20"
      >
        <div className="text-center py-12">
          <motion.div
            initial={{ scale: 0.8, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            className="text-red-500 text-4xl mb-2"
          >
            ❌
          </motion.div>
          <p className="text-red-600 font-medium">{error.message || 'Failed to load characters'}</p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600"
          >
            Retry
          </motion.button>
        </div>
      </motion.div>
    );
  }

  if (characters.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-white/80 backdrop-blur-sm rounded-3xl p-8 shadow-2xl border border-white/20"
      >
        <div className="text-center py-12">
          <motion.div
            initial={{ scale: 0.8, y: -10 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="text-gray-400 text-6xl mb-4"
          >
            🎭
          </motion.div>
          <h3 className="text-2xl font-bold text-gray-600 mb-2">No Characters Available</h3>
          <p className="text-gray-500">Character information will appear here once imported.</p>
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-white/90 via-white/80 to-teal-50/80 backdrop-blur-sm rounded-3xl p-8 shadow-2xl border border-white/20"
      >
        <div className="flex items-center justify-between mb-8">
          <motion.h2
            initial={{ x: -20 }}
            animate={{ x: 0 }}
            className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-teal-800 to-cyan-600 bg-clip-text text-transparent flex items-center"
          >
            <motion.i
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="ri-group-line mr-3 text-pink-500 text-3xl"
            />
            Characters
          </motion.h2>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-gray-600 bg-white/60 px-3 py-1 rounded-full"
          >
            {characters.length} characters
          </motion.div>
        </div>

        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="flex items-center gap-2 mb-8"
        >
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="px-4 py-2 rounded-2xl font-medium bg-gradient-to-r from-teal-500 via-cyan-500 to-blue-500 text-white shadow-xl flex items-center"
          >
            <span className="mr-2 text-xl">⭐</span>
            Main Characters
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-gray-600"
          >
            ({getFilteredCharacters().length} main characters)
          </motion.div>
        </motion.div>

        <Suspense fallback={<div className="bg-gray-200 animate-pulse h-64 rounded-2xl"></div>}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
          >
            {filteredCharacters.map((character, index) => (
              <CharacterCard
                key={character.id}
                character={character}
                index={index}
                onOpen={openCharacter}
              />
            ))}
          </motion.div>
        </Suspense>

        {filteredCharacters.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-12"
          >
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="text-gray-400 text-6xl mb-4"
            >
              ⭐
            </motion.div>
            <h3 className="text-xl font-medium text-gray-900 mb-2">No main characters found</h3>
            <p className="text-gray-500">No main characters found for this anime.</p>
          </motion.div>
        )}
      </motion.div>

      <AnimatePresence>
        {selectedCharacter && (
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
            className="fixed inset-0 z-50 flex"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeCharacter}
              className="bg-black/60 backdrop-blur-md flex-1"
            />
            <Suspense fallback={<div className="bg-gray-200 animate-pulse h-full w-full max-w-md"></div>}>
              <CharacterDetails character={selectedCharacter} onClose={closeCharacter} />
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}