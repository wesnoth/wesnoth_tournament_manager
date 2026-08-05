import React from 'react';
import PlayerLink from './PlayerLink';

interface EntryMember {
  user_id: string;
  nickname: string;
}

interface TournamentEntryNameProps {
  name: string;
  userId?: string | null;
  members?: EntryMember[] | string | null;
  className?: string;
}

/** Render an entry label while keeping every real player name navigable. */
const TournamentEntryName: React.FC<TournamentEntryNameProps> = ({ name, userId, members, className = '' }) => {
  const parsedMembers = typeof members === 'string'
    ? (() => {
        try { return JSON.parse(members) as EntryMember[]; } catch { return []; }
      })()
    : (members || []);

  if (userId) return <PlayerLink nickname={name} userId={userId} className={className} />;
  if (!parsedMembers.length) return <span className={className}>{name}</span>;

  const teamName = name.replace(/\s\([^()]*(?:\([^()]*\)[^()]*)*\)$/, '');
  return <span className={className}>
    {teamName} ({parsedMembers.map((member, index) => <React.Fragment key={member.user_id}>
      {index > 0 && ', '}
      <PlayerLink nickname={member.nickname} userId={member.user_id} />
    </React.Fragment>)})
  </span>;
};

export default TournamentEntryName;
