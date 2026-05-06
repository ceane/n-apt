import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
console.log(`UNSAFE_LOCAL_USER_PASSWORD: ${process.env.UNSAFE_LOCAL_USER_PASSWORD}`);
console.log(`VITE_UNSAFE_LOCAL_USER_PASSWORD: ${process.env.VITE_UNSAFE_LOCAL_USER_PASSWORD}`);
