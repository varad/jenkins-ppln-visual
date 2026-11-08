pipeline {
    agent none
    stages {
        stage('Matrix') {
            matrix {
                agent { label "${PLATFORM}" }
                when { anyOf { expression { params.FULL }; branch 'main' } }
                axes {
                    axis { name 'PLATFORM'; values 'linux', 'windows', 'mac' }
                    axis { name 'JDK'; values '11', '17', '21' }
                    axis { name 'DB'; values 'postgres', 'mysql' }
                }
                excludes {
                    exclude {
                        axis { name 'PLATFORM'; values 'mac' }
                        axis { name 'DB'; notValues 'postgres' }
                    }
                }
                stages {
                    stage('Build') { steps { sh './build.sh' } }
                    stage('Test') { steps { sh "./test.sh ${DB}" } }
                }
                post { always { junit '**/*.xml' } }
            }
        }
    }
}
