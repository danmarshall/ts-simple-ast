﻿import {GlobalContainer} from "./../GlobalContainer";
import {KeyValueCache, ArrayUtils, FileUtils, createHashSet} from "./../utils";
import {Directory} from "./../fileSystem/Directory";

/**
 * Cache for the directories.
 * @internal
 */
export class DirectoryCache {
    private readonly directoriesByPath = new KeyValueCache<string, Directory>();
    private readonly orphanDirs = createHashSet<Directory>();

    constructor(private readonly global: GlobalContainer) {
    }

    has(dirPath: string) {
        return this.directoriesByPath.has(dirPath);
    }

    get(dirPath: string) {
        return this.directoriesByPath.get(dirPath);
    }

    getOrphans() {
        return Array.from(this.orphanDirs.values());
    }

    remove(dirPath: string) {
        return this.directoriesByPath.removeByKey(dirPath);
    }

    addIfNotExists(dirPath: string) {
        if (this.has(dirPath))
            return this.get(dirPath)!;

        this.fillParentsOfDirPath(dirPath);
        return this.createDirectory(dirPath);
    }

    private createDirectory(path: string) {
        const newDirectory = new Directory(this.global, path);
        const parentDirPath = FileUtils.getDirPath(path);
        const isRootDir = parentDirPath === path;

        for (const childDir of this.directoriesByPath.getValues()) {
            const childDirPath = childDir.getPath();
            const childDirParentPath = FileUtils.getDirPath(childDirPath);
            const isChildRootDir = childDirParentPath === childDirPath;
            if (!isChildRootDir && childDirParentPath === path) {
                newDirectory._addDirectory(childDir);
                this.orphanDirs.delete(childDir);
            }
        }

        if (!isRootDir) {
            const parentDir = this.directoriesByPath.get(parentDirPath);
            if (parentDir != null)
                parentDir._addDirectory(newDirectory);
        }

        if (newDirectory.getParent() == null)
            this.orphanDirs.add(newDirectory);

        this.directoriesByPath.set(path, newDirectory);

        for (const orphanDir of this.orphanDirs.values()) {
            if (newDirectory.isAncestorOfDir(orphanDir))
                this.fillParentsOfDirPath(orphanDir.getPath());
        }

        return newDirectory;
    }

    private fillParentsOfDirPath(dirPath: string) {
        const passedDirPaths: string[] = [];
        let dir = dirPath;
        let parentDir = FileUtils.getDirPath(dir);
        while (dir !== parentDir) {
            dir = parentDir;
            parentDir = FileUtils.getDirPath(dir);
            if (this.directoriesByPath.has(dir)) {
                for (const currentDirPath of passedDirPaths)
                    this.createDirectory(currentDirPath);
                break;
            }

            passedDirPaths.unshift(dir);
        }
    }
}