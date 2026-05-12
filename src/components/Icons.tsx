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
    <rect x="3" y="3" width="18" height="18" rx="6" fill="currentColor" fillOpacity="0.1" />
    <rect x="3" y="3" width="18" height="18" rx="6" stroke="currentColor" strokeWidth="2" />
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
