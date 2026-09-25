import { redirect } from 'next/navigation';
import { getLocalUser } from '@/server/auth';
import ClassroomApp from './classroom-app';
export const dynamic='force-dynamic';
export default async function Page(){if(!await getLocalUser())redirect('/login');return <ClassroomApp/>;}
