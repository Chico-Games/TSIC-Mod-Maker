import { getHandle, putHandle, deleteHandle } from '../handleStore';

const KEY = 'tsic.default-project-source';

export async function setDefaultSourceHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await putHandle(KEY, handle as any);
}
export async function getDefaultSourceHandle(): Promise<FileSystemDirectoryHandle | null> {
  return (await getHandle(KEY)) as FileSystemDirectoryHandle | null;
}
export async function clearDefaultSourceHandle(): Promise<void> {
  await deleteHandle(KEY);
}
