import { redirect } from 'next/navigation';
import { getLocalUser } from '@/server/auth';
import LoginForm from './login-form';
export const dynamic='force-dynamic';
export default async function LoginPage(){if(await getLocalUser())redirect('/');return <LoginForm/>;}
