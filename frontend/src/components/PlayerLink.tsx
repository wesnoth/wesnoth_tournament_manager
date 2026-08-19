import React from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

interface PlayerLinkProps {
  nickname: string;
  userId: string;
  className?: string;
  helpId?: string;
}

const PlayerLink: React.FC<PlayerLinkProps> = ({ nickname, userId, className = '', helpId = 'action-player-profile' }) => {
  const { userId: currentUserId } = useAuthStore();
  const profilePath = currentUserId === userId ? '/user' : `/player/${userId}`;

  return (
    <Link
      to={profilePath}
      data-help-id={helpId}
      className={`player-link ${className}`}
    >
      {nickname}
    </Link>
  );
};

export default PlayerLink;
