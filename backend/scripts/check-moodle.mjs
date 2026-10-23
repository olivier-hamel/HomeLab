import { withMoodle } from '../src/lib/moodle/client.ts';

// Run inside the backend container (or on a native backend's VM). Deliberately
// print only counts and response shapes, never document text or credentials.
try {
  await withMoodle(new AbortController().signal, async session => {
    console.log('MCP initialize and three-tool discovery: PASS');
    const courses = await session.courses();
    console.log(`Course listing: PASS (${courses.length} courses)`);
    for (const course of courses) {
      const files = await session.files(course.id);
      console.log(`File listing: PASS (${files.length} files)`);
      const file = files.find(file => file.filesize <= 25 * 1024 * 1024 && /\.(pdf|docx|pptx|txt|md|csv|json|html?|xml|ya?ml|rst|tex|log)$/i.test(file.filename));
      if (!file) continue;
      const result = await session.read(course.id, file.id);
      console.log(`Supported file read: PASS (${Array.from(result.text).length} returned characters; truncated=${result.truncated})`);
      return;
    }
    throw new Error('No supported file available');
  });
} catch (error) {
  console.error(`Moodle check failed (${error?.code || 'unavailable'}); private response omitted.`);
  process.exitCode = 1;
}
