import { Node } from "../common";
import { ts } from "../../../typescript";
import { ExportSpecifier } from "./ExportSpecifier";

export const NamedExportsBase = Node;
export class NamedExports extends NamedExportsBase<ts.NamedExports> {
    /** Gets the export specifiers. */
    getElements(): ExportSpecifier[] {
        return this.compilerNode.elements.map(e => this.getNodeFromCompilerNode(e));
    }
}
