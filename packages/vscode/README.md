# Jenkinsfile Visualizer

Draws the stages of a declarative Jenkinsfile (`pipeline { ... }`): sequential, `parallel`, nested `stages`,
`matrix`, `when`, `input`, `agent` and `post`.

Open a `Jenkinsfile`, `*.Jenkinsfile` or `Jenkinsfile.*` and click **Open Pipeline Preview** in the
editor title bar. The diagram opens under the code, since pipeline drawings are wide; set
`jenkinsfileVisualizer.previewPosition` to `beside` to open it on the right. In the diagram:

- click a stage to move the caret to it; placing the caret inside a stage rings it in the diagram;
- drag a stage to move it, or onto the trash area to remove it; double-click its name to rename it.

Each change is a normal edit to the file, so **Undo** reverts it. The wrap button in the preview's title bar
switches between wrapping the diagram to the panel width and one long row.
