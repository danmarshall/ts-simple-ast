import { CodeBlockWriter } from "../../codeBlockWriter";
import { Node } from "../../compiler";
import { SyntaxKind, ts } from "../../typescript";
import { TypeGuards, StringUtils } from "../../utils";
import { getEndPosFromIndex, getInsertPosFromIndex, getRangeFromArray, verifyAndGetIndex } from "../helpers";
import { NodeHandlerFactory } from "../nodeHandlers";
import { InsertionTextManipulator } from "../textManipulators";
import { doManipulation } from "./doManipulation";

export interface InsertIntoParentTextRangeOptions {
    insertPos: number;
    newText: string;
    parent: Node;
    replacing?: {
        textLength: number;
        nodes?: Node[];
    };
    customMappings?: (newParentNode: ts.Node) => { currentNode: Node; newNode: ts.Node; }[];
}

/**
 * Inserts a text range into a parent.
 */
export function insertIntoParentTextRange(opts: InsertIntoParentTextRangeOptions) {
    const {insertPos, newText, parent} = opts;

    // todo: this should only forget the existing node if the kind changes
    doManipulation(parent.sourceFile,
        new InsertionTextManipulator({
            insertPos,
            newText,
            replacingLength: opts.replacing == null ? undefined : opts.replacing.textLength
        }), new NodeHandlerFactory().getForRange({
            parent,
            start: insertPos,
            end: insertPos + newText.length,
            replacingLength: opts.replacing == null ? undefined : opts.replacing.textLength,
            replacingNodes: opts.replacing == null ? undefined : opts.replacing.nodes,
            customMappings: opts.customMappings
        }));
}

export interface InsertIntoCommaSeparatedNodesOptions {
    currentNodes: Node[];
    insertIndex: number;
    newText: string;
    parent: Node;
    useNewLines?: boolean;
    surroundWithSpaces?: boolean;
}

const endsWithComma = /\,\s*$/;
const startsWithComma = /^\s*\,/;

export function insertIntoCommaSeparatedNodes(opts: InsertIntoCommaSeparatedNodesOptions) {
    const { currentNodes, insertIndex, parent } = opts;
    const nextNode = currentNodes[insertIndex] as Node | undefined;
    const previousNode = currentNodes[insertIndex - 1] as Node | undefined;
    const separator = opts.useNewLines ? parent.context.manipulationSettings.getNewLineKindAsString() : " ";
    const parentNextSibling = parent.getNextSibling();
    const isContained = parentNextSibling != null && (
        parentNextSibling.getKind() === SyntaxKind.CloseBraceToken || parentNextSibling.getKind() === SyntaxKind.CloseBracketToken
    );
    let { newText } = opts;

    if (previousNode != null) {
        prependCommaAndSeparator();

        if (nextNode != null)
            appendCommaAndSeparator();
        else if (opts.useNewLines || opts.surroundWithSpaces)
            appendSeparator();
        else
            appendIndentation();

        const nextEndStart = nextNode == null ? (isContained ? parentNextSibling!.getStart(true) : parent.getEnd()) : nextNode.getStart(true);
        const insertPos = previousNode.getEnd();
        insertIntoParentTextRange({
            insertPos,
            newText,
            parent,
            replacing: { textLength: nextEndStart - insertPos }
        });
    }
    else if (nextNode != null) {
        if (opts.useNewLines || opts.surroundWithSpaces)
            prependSeparator();

        appendCommaAndSeparator();

        const insertPos = isContained ? parent.getPos() : parent.getStart(true);
        insertIntoParentTextRange({
            insertPos,
            newText,
            parent,
            replacing: { textLength: nextNode.getStart(true) - insertPos }
        });
    }
    else {
        if (opts.useNewLines || opts.surroundWithSpaces) {
            prependSeparator();
            appendSeparator();
        }
        else
            appendIndentation();

        insertIntoParentTextRange({
            insertPos: parent.getPos(),
            newText,
            parent,
            replacing: { textLength: parent.getNextSiblingOrThrow().getStart() - parent.getPos() }
        });
    }

    function prependCommaAndSeparator() {
        if (!startsWithComma.test(newText)) {
            prependSeparator();
            newText = `,${newText}`;
        }
    }

    function prependSeparator() {
        if (!StringUtils.startsWithNewLine(newText))
            newText = separator + newText;
    }

    function appendCommaAndSeparator() {
        if (!endsWithComma.test(newText)) {
            newText = StringUtils.insertAtLastNonWhitespace(newText, ",");
            appendSeparator();
        }
        else
            appendIndentation();
    }

    function appendSeparator() {
        if (!StringUtils.endsWithNewLine(newText))
            newText += separator;
        appendIndentation();
    }

    function appendIndentation() {
        if (opts.useNewLines || StringUtils.endsWithNewLine(newText)) {
            if (nextNode != null)
                newText += parent.getParentOrThrow().getChildIndentationText();
            else
                newText += parent.getParentOrThrow().getIndentationText();
        }
    }
}

export interface InsertIntoBracesOrSourceFileOptionsWriteInfo {
    previousMember: Node | undefined;
    nextMember: Node | undefined;
    isStartOfFile: boolean;
}

export interface InsertIntoBracesOrSourceFileOptions {
    parent: Node;
    children: Node[];
    index: number;
    write: (writer: CodeBlockWriter, info: InsertIntoBracesOrSourceFileOptionsWriteInfo) => void;
}

/**
 * Used to insert non-comma separated nodes into braces or a source file.
 */
export function insertIntoBracesOrSourceFile(opts: InsertIntoBracesOrSourceFileOptions) {
    const { parent, index, children } = opts;
    const fullText = parent.sourceFile.getFullText();
    const insertPos = getInsertPosFromIndex(index, parent.getChildSyntaxListOrThrow(), children);
    const endPos = getEndPosFromIndex(index, parent, children, fullText);
    const replacingLength = endPos - insertPos;
    const newText = getNewText();

    doManipulation(parent.sourceFile, new InsertionTextManipulator({ insertPos, replacingLength, newText }), new NodeHandlerFactory().getForRange({
        parent: parent.getChildSyntaxListOrThrow(),
        start: insertPos,
        end: insertPos + newText.length,
        replacingLength
    }));

    function getNewText() {
        // todo: make this configurable
        const writer = parent.getWriterWithChildIndentation();
        opts.write(writer, {
            previousMember: getChild(children[index - 1]),
            nextMember: getChild(children[index]),
            isStartOfFile: insertPos === 0
        });
        return writer.toString();

        function getChild(child: Node | undefined) {
            // ensure it passes the implementation
            if (child == null)
                return child;
            else if (TypeGuards.isOverloadableNode(child))
                return child.getImplementation() || child;
            else
                return child;
        }
    }
}

export interface InsertIntoBracesOrSourceFileWithGetChildrenOptions<TNode extends Node, TStructure> {
    getIndexedChildren: () => Node[];
    write: (writer: CodeBlockWriter, info: InsertIntoBracesOrSourceFileOptionsWriteInfo) => void;
    // for child functions
    expectedKind: SyntaxKind;
    structures: ReadonlyArray<TStructure>;
    parent: Node;
    index: number;
}

/**
 * Glues together insertIntoBracesOrSourceFile and getRangeFromArray.
 * @param opts - Options to do this operation.
 */
export function insertIntoBracesOrSourceFileWithGetChildren<TNode extends Node, TStructure>(
    opts: InsertIntoBracesOrSourceFileWithGetChildrenOptions<TNode, TStructure>
) {
    if (opts.structures.length === 0)
        return [];

    const startChildren = opts.getIndexedChildren();
    const parentSyntaxList = opts.parent.getChildSyntaxListOrThrow();
    const index = verifyAndGetIndex(opts.index, startChildren.length);

    insertIntoBracesOrSourceFile({
        parent: opts.parent,
        index: getChildIndex(),
        children: parentSyntaxList.getChildren(),
        write: opts.write
    });

    return getRangeFromArray<TNode>(opts.getIndexedChildren(), opts.index, opts.structures.length, opts.expectedKind);

    function getChildIndex() {
        if (index === 0)
            return 0;

        // get the previous member in order to get the implementation signature + 1
        return startChildren[index - 1].getChildIndex() + 1;
    }
}
