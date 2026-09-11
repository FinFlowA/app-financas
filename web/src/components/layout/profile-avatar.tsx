"use client";

import Image from "next/image";
import { useState } from "react";

type ProfileAvatarProps = {
  imageUrl: string | null;
  name: string;
};

export default function ProfileAvatar({ imageUrl, name }: ProfileAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const initial = name.slice(0, 1).toLocaleUpperCase("pt-BR") || "U";
  const visibleImageUrl = imageUrl && failedImageUrl !== imageUrl ? imageUrl : null;

  return (
    <span className="ff-sidebar-profile__avatar" aria-hidden="true">
      {initial}
      {visibleImageUrl && (
        <Image
          src={visibleImageUrl}
          alt=""
          fill
          sizes="36px"
          className="ff-sidebar-profile__avatar-image"
          onError={() => setFailedImageUrl(visibleImageUrl)}
        />
      )}
    </span>
  );
}
