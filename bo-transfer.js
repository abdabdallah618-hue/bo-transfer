// BO-Transfer Old System Logic (Refactored)
// -----------------------------------------
// This file restores and modernizes the old system logic for arranging pasted user transfer data.
// It adds robust handling for a vertical 3-column pasted format like the one you provided.
//
// Supported input shapes:
// 1. Normal row-wise lines:  CONTRACT ZONE_OLD ZONE_NEW
// 2. Lines where ZONE_NEW is on the next line (auto-merge as before)
// 3. Vertical stacked columns (block of contracts, then block of old zones, then block of new zones)
// 4. Mixed noise / blank lines ignored
//
// Output format after Arrange: CONTRACT<TAB>ZONE_OLD<TAB>ZONE_NEW

(function(){
    const textarea = document.getElementById('raw');
    const arrangeBtn = document.getElementById('arrangeColumnsBtn');
    if(!textarea || !arrangeBtn) return;

    // Regex patterns
    const contractRegex = /^[A-Za-z]{3}\d{3}FAT\d+(?:-\d+)?$/i; // e.g. FDT325FAT22-001 or fbb333fat42-10
    const zoneOldRegex = /^[A-Za-z]{3}\d{3}$/i;                   // e.g. FBB325
    const zoneNewRegex = /^[A-Za-z]{3}\d{3}-\d+$/i;              // e.g. FBB325-3
    const zoneCandidateRegex = /^[A-Za-z\u0621-\u064A]{3}\d{3,4}(?:-[0-9A-Za-z]+)?$/; // legacy merge helper

    // ------------------ Utility classification helpers ------------------
    function isContract(t){ return contractRegex.test(t); }
    function isOldZone(t){ return zoneOldRegex.test(t); }
    function isNewZone(t){ return zoneNewRegex.test(t); }

    function sanitizeToken(str){
        if(!str) return '';
        return str
            .replace(/\u00A0/g,' ')                 // nbsp -> space
            .replace(/["“”]/g,'')                   // remove quotes
            .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'') // bidi marks
            .trim();
    }

    function cleanZeros(token){
        return token ? token.replace(/([A-Za-z\u0621-\u064A]+)0+(\d+)/g, '$1$2') : token;
    }

    function addZeros(zone){
        // New policy: DO NOT pad if the numeric block already has length 3 (e.g. FBB325) or if there is a suffix part (-3 / -12 etc.)
        // Only pad lengths 1-2 when there is no suffix, and keep length 4 as-is.
        if(!zone) return zone;
        const m = zone.match(/^([A-Za-z\u0621-\u064A]{3})(\d{1,4})(.*)$/);
        if(m){
            const prefix = m[1];
            const digits = m[2];
            const rest = m[3] || '';
            if(rest){
                // Has suffix like -3 -> keep original digits (no padding) to preserve user format.
                return prefix + digits + rest;
            }
            if(digits.length === 3 || digits.length === 4){
                return prefix + digits + rest; // leave unchanged
            }
            // If digits length 1-2, pad to 3 (not 4) for a lighter normalization.
            return prefix + digits.padStart(3, '0') + rest;
        }
        return zone;
    }

    // Robust vertical blocks detection covering:
    // 1) Three blocks separated by >=1 blank line each.
    // 2) Single stream of tokens (no blank lines) but ordered phases (contracts -> old -> new).
    // 3) Equal-length heuristic: if total lines count divisible by 3 and pattern groups plausible.
    function detectVerticalBlocks(lines){
        // A. Split by blank lines (keep empties separate)
        const blocksRaw = [];
        let current = [];
        for(const line of lines){
            if(line === ''){
                if(current.length){ blocksRaw.push(current); current = []; }
            } else {
                // Accept only single-token lines (no spaces / tabs) for vertical mode
                const tok = line.trim();
                if(tok.includes(' ') || tok.includes('\t')) return null; // bail: not purely vertical
                current.push(tok);
            }
        }
        if(current.length) blocksRaw.push(current);

        const classifyBlock = (arr, type)=>{
            if(!arr.length) return false;
            if(type==='contracts') return arr.every(isContract);
            if(type==='old') return arr.every(isOldZone);
            if(type==='new') return arr.every(isNewZone);
            return false;
        };

        // Path 1: exactly 3 separated blocks
        if(blocksRaw.length === 3){
            const perms = [ [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0] ];
            for(const p of perms){
                const b0=blocksRaw[p[0]], b1=blocksRaw[p[1]], b2=blocksRaw[p[2]];
                if(classifyBlock(b0,'contracts') && classifyBlock(b1,'old') && classifyBlock(b2,'new')){
                    return [b0,b1,b2];
                }
            }
        }

        // Collect all single-token lines ignoring blanks for streaming heuristic
        const tokens = lines.filter(l => l && !l.includes(' ') && !l.includes('\t'));
        if(tokens.length >= 6){
            let phase = 0; // 0: contracts, 1: old, 2: new
            const blocks = [[],[],[]];
            for(const t of tokens){
                if(phase === 0){
                    if(isContract(t)) { blocks[0].push(t); continue; }
                    if(isOldZone(t) && blocks[0].length){ phase = 1; blocks[1].push(t); continue; }
                    return null;
                } else if(phase === 1){
                    if(isOldZone(t)) { blocks[1].push(t); continue; }
                    if(isNewZone(t) && blocks[1].length){ phase = 2; blocks[2].push(t); continue; }
                    return null;
                } else { // phase 2
                    if(isNewZone(t)) { blocks[2].push(t); continue; }
                    return null;
                }
            }
            if(blocks[0].length && blocks[1].length && blocks[2].length){
                return blocks;
            }
        }

        // Equal-length heuristic: if total single-token lines divisible by 3, try slicing
        if(tokens.length % 3 === 0 && tokens.length >= 6){
            const slice = tokens.length / 3;
            const cPart = tokens.slice(0, slice);
            const oPart = tokens.slice(slice, slice*2);
            const nPart = tokens.slice(slice*2);
            if(classifyBlock(cPart,'contracts') && classifyBlock(oPart,'old') && classifyBlock(nPart,'new')){
                return [cPart,oPart,nPart];
            }
        }
        return null;
    }

    function arrangeVertical(blocks){
        const [contracts, olds, news] = blocks;
        const equal = (contracts.length === olds.length && olds.length === news.length);
        let n = Math.min(contracts.length, olds.length, news.length);
        if(!equal){
            alert(`تحذير: الأطوال غير متساوية في التنسيق العمودي (Contracts=${contracts.length}, Old=${olds.length}, New=${news.length})\nسيتم استخدام أول ${n} صفوف فقط.`);
        }
        const rows = [];
        for(let i=0;i<n;i++){
            const c = contracts[i];
            const zOld = addZeros(olds[i]);
            const zNew = addZeros(news[i]);
            rows.push(`${c}\t${zOld}\t${zNew}`);
        }
        return rows;
    }

    function legacyMerge(lines){
        // Original merge logic: merge single zone line following two-column line
        const merged = [];
        for(let i=0;i<lines.length;i++){
            let line = lines[i];
            if(line === '') continue;
            const tokens = line.split(/\s+/).filter(Boolean);
            if(tokens.length === 1 && zoneCandidateRegex.test(tokens[0]) && merged.length>0){
                const prev = merged[merged.length-1];
                const prevTokens = prev.split(/\s+/).filter(Boolean);
                if(prevTokens.length === 2){
                    merged[merged.length-1] = prev + '\t' + tokens[0];
                    continue;
                }
            }
            merged.push(line);
        }
        return merged;
    }

    function arrangeFreeForm(merged){
        return merged
            .map(line => line.split(/\s+/).map(sanitizeToken).filter(Boolean))
            .filter(parts => parts.length >= 3)
            .map(parts => {
                // Assume: contract, old zone, rest -> new zone (last token)
                const contract = parts[0];
                const zoneOld = addZeros(parts[1]);
                const zoneNew = addZeros(parts[parts.length-1]);
                return `${contract}\t${zoneOld}\t${zoneNew}`;
            });
    }

    function processInput(raw){
        // 1. Split input into lines, keep blanks for vertical detection
        const linesWithBlanks = raw.replace(/\r/g,'').split(/\n/).map(s => sanitizeToken(s));
        // 2. Try vertical blocks first
        const vertical = detectVerticalBlocks(linesWithBlanks);
        if(vertical){
            return arrangeVertical(vertical);
        }
        // 3. Try row-wise: lines with 3+ columns (space/tab separated)
        const cleaned = linesWithBlanks.filter(l => l !== '');
        // Special Excel paste: all data in one line, 3*N columns
        if (cleaned.length === 1) {
            const parts = cleaned[0].split(/[\t ]+/).map(sanitizeToken).filter(Boolean);
            if (parts.length % 3 === 0 && parts.length >= 3) {
                const rows = [];
                for (let i = 0; i < parts.length; i += 3) {
                    const contract = parts[i];
                    const zoneOld = addZeros(parts[i+1]);
                    const zoneNew = addZeros(parts[i+2]);
                    rows.push(`${contract}\t${zoneOld}\t${zoneNew}`);
                }
                return rows;
            }
        }
        // عادي: كل سطر فيه 3 أعمدة أو أكثر
        const rowwise = cleaned
            .map(line => line.split(/[\t ]+/).map(sanitizeToken).filter(Boolean))
            .filter(parts => parts.length >= 3)
            .map(parts => {
                const contract = parts[0];
                const zoneOld = addZeros(parts[1]);
                const zoneNew = addZeros(parts[2]);
                return `${contract}\t${zoneOld}\t${zoneNew}`;
            });
        if(rowwise.length > 0 && rowwise.length === cleaned.length){
            // All lines are row-wise, return directly
            return rowwise;
        }
        // 4. Fallback: legacy merge (handles 2-cols + zone on next line)
        const merged = legacyMerge(cleaned);
        return arrangeFreeForm(merged);
    }

    arrangeBtn.addEventListener('click', () => {
        const text = textarea.value;
        if(!text.trim()) return;
        const rows = processInput(text);
        if(rows.length === 0){
            alert('لم يتم التعرف على أي صف صالح.');
            return;
        }
        textarea.value = rows.join('\n');
    });
})();
