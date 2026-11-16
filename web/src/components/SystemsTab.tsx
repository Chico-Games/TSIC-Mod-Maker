import { ClassRailTab } from './classBrowser/ClassRailTab';

/** Everything that is neither an item nor a piece of furniture and has no
 *  purpose-built editor: world rules, sound slots, hotkeys, random events… */
export function SystemsTab() {
  return <ClassRailTab home="systems" />;
}
