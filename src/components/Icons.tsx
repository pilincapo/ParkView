import React from 'react';

export const StylizedLetterA = ({ className, size = 24 }: { className?: string, size?: number }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    className={className}
    referrerPolicy="no-referrer"
  >
    <path 
      d="M12 4L5 20H19L12 4Z" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
    />
    <path 
      d="M9 14H15" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
    />
  </svg>
);

export const ParkingIcon = ({ className, size = 24 }: { className?: string, size?: number }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    className={className}
    referrerPolicy="no-referrer"
  >
    <path 
      d="M9 17V7H13.5C15.433 7 17 8.567 17 10.5V10.5C17 12.433 15.433 14 13.5 14H9" 
      stroke="currentColor" 
      strokeWidth="2.5" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
    />
    <circle cx="17" cy="17" r="1" fill="currentColor" />
  </svg>
);

export const MotorcycleIcon = ({ className, size = 24 }: { className?: string, size?: number }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg" 
    className={className}
    referrerPolicy="no-referrer"
  >
    <circle cx="7.5" cy="15.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="16.5" cy="15.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    <path 
      d="M10 15.5L12 11H15M12 11L13.5 8.5H15M12 11L10.5 12.5M15 11L16 14" 
      stroke="currentColor" 
      strokeWidth="1.5" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
    />
  </svg>
);
