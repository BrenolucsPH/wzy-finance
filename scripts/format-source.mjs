import ts from 'typescript';
import fs from 'node:fs';
const files=['app/dashboard.tsx','app/components.tsx','app/settings.tsx','app/views.tsx','app/api/[...path]/route.ts','lib/server.ts','lib/finance.ts','lib/validation.ts','db/schema.ts','next.config.ts'];
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
for(const file of files){const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);fs.writeFileSync(file,printer.printFile(source));}
